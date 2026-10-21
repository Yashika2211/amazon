import type { NextFunction, Request, Response } from "express";

/**
 * Fixed-window rate limiter keyed by client IP and route. Per Lambda instance, which is enough to
 * blunt PIN guessing; AWS WAF on the URL would be the production upgrade.
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${opts.name}:${req.ip}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    if (entry.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: "rate_limited", message: "Too many attempts. Please wait a minute and try again." });
      return;
    }
    next();
  };
}
