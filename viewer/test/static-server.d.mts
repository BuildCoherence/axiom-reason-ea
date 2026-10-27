import type { Server } from "node:http";

export declare function createExportServer(
  outDir: string,
  options?: { workspace?: string },
): Server;
export declare function listen(server: Server): Promise<string>;
