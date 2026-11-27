import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const prefix='/pesennik/';
const server=http.createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://127.0.0.1:8080');
    if(url.pathname==='/pesennik'){response.writeHead(302,{Location:prefix});response.end();return;}
    if(!url.pathname.startsWith(prefix))throw new Error('not found');
    const relative=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';
    const filename=path.resolve(root,relative);
    if(!filename.startsWith(path.resolve(root)+path.sep))throw new Error('not found');
    if(!(await stat(filename)).isFile())throw new Error('not found');
    const data=await readFile(filename);
    response.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});response.end(data);
    console.log(`${request.method} ${url.pathname}${url.search} 200`);
  }catch{response.writeHead(404);response.end('Not found');}
});
server.listen(8080,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8080/pesennik/'));
