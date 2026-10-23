import { Request, Response, NextFunction } from 'express';

export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

export function rawBodySaver(req: RequestWithRawBody, _res: Response, buf: Buffer) {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}
