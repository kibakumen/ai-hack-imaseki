import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

export default nextConfig;

// next dev でも D1 などの Cloudflare のバインディングを使えるようにする（手元では模擬環境）
initOpenNextCloudflareForDev();
