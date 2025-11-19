declare module "https://deno.land/std@0.203.0/http/server.ts" {
  export function serve(
    handler: (request: Request) => Response | Promise<Response>
  ): void;
}
