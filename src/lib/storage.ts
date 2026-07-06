import path from 'path';
import fs from 'fs/promises';

export interface StorageResult {
  url: string;
  key: string;
}

export interface IStorageProvider {
  upload(file: Buffer | File, filename: string): Promise<StorageResult>;
  delete(key: string): Promise<void>;
}

class LocalStorageProvider implements IStorageProvider {
  private readonly root: string;

  constructor() {
    this.root = path.join(process.cwd(), 'public', 'uploads');
  }

  async upload(file: Buffer | File, filename: string): Promise<StorageResult> {
    const dest = path.join(this.root, filename);
    await fs.mkdir(path.dirname(dest), { recursive: true });

    let buffer: Buffer;
    if (Buffer.isBuffer(file)) {
      buffer = file;
    } else {
      const ab = await (file as File).arrayBuffer();
      buffer = Buffer.from(ab);
    }

    await fs.writeFile(dest, buffer);
    return { url: `/uploads/${filename}`, key: `uploads/${filename}` };
  }

  async delete(key: string): Promise<void> {
    const dest = path.join(this.root, key.replace(/^uploads\//, ''));
    await fs.unlink(dest).catch(() => {});
  }
}

export const storage = new LocalStorageProvider();
