import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
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

    let countryCode = "US"; // default
    let country = "United States";
    let city = "";
    let region = "";
    let detectedIp = ip;

    // Kiểm tra nếu IP là localhost hoặc không hợp lệ
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

    // Ưu tiên IPINFO nếu có token và IP hop le
    let usedIpinfo = false;
    if (!isLocalhost && ip && ip !== "unknown" && ipinfoToken) {
      try {
        const res = await fetch(`https://ipinfo.io/${ip}?token=${ipinfoToken}`);
        const data = await res.json();
        if (!data?.error && (data?.country || data?.city || data?.region)) {
          const ipinfoCountryCode = data.country || "";
          const ipinfoCountryName = countryNameFromCode(ipinfoCountryCode);
          countryCode = ipinfoCountryCode || countryCode;
          country = ipinfoCountryName || country;
          city = data.city || city;
          region = data.region || region;
          if (data.ip) {
            detectedIp = data.ip;
          }
          usedIpinfo = true;
        }
      } catch (error) {
        if (debugGeo) {
          console.error("[geo-debug] ipinfo error:", error);
        }
      }
    }

    return NextResponse.json({
      success: usedIpinfo,
      countryCode,
      ip: detectedIp,
      country,
      city,
      region,
    });
  } catch (error) {
    console.error("Detect location error:", error);
    return NextResponse.json({ success: false, countryCode: "US", ip: "unknown" });
  }
}
