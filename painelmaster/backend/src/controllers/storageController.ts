import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

export const serveStorageFile = (req: Request, res: Response) => {
  try {
    const filePath = req.path.substring(1); // Remove barra inicial
    const candidates = [process.env.STORAGE_PATH, '/app/storage', '/home/ubuntu/painel-iptv/backend/storage'].filter(Boolean) as string[];
    const storagePath = candidates.find((p) => fs.existsSync(p)) || candidates[0] || '/app/storage';
    const fullPath = path.join(storagePath, filePath);

    res.sendFile(fullPath, (err) => {
      if (err) {
        res.status(404).json({ error: 'Arquivo não encontrado' });
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' });
  }
};
