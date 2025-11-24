import { createServer } from 'node:http';
import { readFile } from 'node:fs';
import { join, resolve } from 'node:path';

const frontDirectory = resolve(process.cwd(), 'front');

export const httpServer = createServer((req, res) => {
    const requestUrl = req.url ?? '/';
    const relativePath = requestUrl === '/' ? 'index.html' : requestUrl.replace(/^\//, '');
    const filePath = join(frontDirectory, relativePath);

    readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        res.writeHead(200);
        res.end(data);
    });
});
