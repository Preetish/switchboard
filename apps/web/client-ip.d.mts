export declare const CLIENT_IP_HEADER: "x-switchboard-client-ip";
export declare function trustedProxyHops(raw?: string): number;
export declare function resolveClientIp(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  hops: number,
): string;
