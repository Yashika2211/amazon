/** Static export: the app is served by the KinLoop Lambda (same origin as the API), or any static host. */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default nextConfig;
