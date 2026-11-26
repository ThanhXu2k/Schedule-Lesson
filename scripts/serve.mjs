import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const index=fileURLToPath(new URL('../dist/index.html',import.meta.url));
const server=createServer(async(req,res)=>{if(!['/','/index.html','/favicon.ico'].includes(req.url.split('?')[0])){res.writeHead(404);return res.end();}if(req.url==='/favicon.ico'){res.writeHead(204);return res.end();}try{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(index));}catch(_){res.writeHead(503);res.end('Run npm run build first.');}});
server.listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port));
