import { Request, Response } from 'express';
import path from 'path';

export const serveStorageFile = (req: Request, res: Response) => {
  try {
    const filePath = req.path.substring(1); // Remove barra inicial
    const storagePath = '/home/ubuntu/painel-iptv/backend/storage';
    const fullPath = path.join(storagePath, filePath);
    
    console.log('Servindo arquivo:', fullPath);
    
    res.sendFile(fullPath, (err) => {
      if (err) {
        console.error('Erro ao servir arquivo:', err);
        res.status(404).json({ error: 'Arquivo não encontrado' });
      }
    });
  } catch (error) {
    console.error('Erro no serveStorageFile:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};
