import { DEFAULT_DOMAIN, logger, parseParams } from "@mikkel-ol/shared";
import WebSocket from "ws";
import { z } from "zod";
import http from "http";

const schema = z.object({
  token: z.string(),
  secure: z.boolean().default(true).optional(),
  domain: z.string().default(DEFAULT_DOMAIN).optional(),
  subdomain: z.string().optional(),
  port: z.number().int().positive(),
});

export interface Tunnel {
  url: string;
}

export const tunnel = {
  async start(config: z.infer<typeof schema>): Promise<Tunnel> {
    return new Promise((resolve, reject) => {
      const { token, secure, domain, subdomain, port } = schema.parse(config);

      const query = new URLSearchParams({ port: port.toString(), token });
      if (subdomain) query.set("subdomain", subdomain);

      parseParams(query);

      const wsSchema = secure ? "wss" : "ws";
      const url = `${wsSchema}://${domain}?${query.toString()}`;

      logger.debug(`Connecting to tunnel server at ${url}`);
      const ws = new WebSocket(url);

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === "tunnel-ready") {
          return resolve({ url: msg.url });
        }

        if (msg.type === "http-request") {
          const { requestId, method, url, headers, body } = msg;
          const opts = {
            hostname: "localhost",
            port,
            path: url,
            method,
            headers,
          };

          const req = http.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              ws.send(
                JSON.stringify({
                  type: "http-response",
                  requestId,
                  status: res.statusCode,
                  headers: res.headers,
                  body: Buffer.concat(chunks).toString("base64"),
                }),
              );
            });
          });

          req.on("error", () => {
            ws.send(
              JSON.stringify({
                type: "http-response",
                requestId,
                status: 502,
                headers: {},
                body: "",
              }),
            );
          });

          if (body) req.write(Buffer.from(body, "base64"));
          req.end();
        }
      });
    });
  },
};
