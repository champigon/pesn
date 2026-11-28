import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validCatalog} from '../web/storage.js';
// Build catalog.json from the checked-out songs first. No network access during Gradle or app startup.
const catalog=await readFile(new URL('../dist/catalog.json',import.meta.url),'utf8');
if(!validCatalog(JSON.parse(catalog)))throw new Error('Invalid catalog for APK');
const destination=new URL('../android/app/src/main/assets/',import.meta.url);
await mkdir(destination,{recursive:true});
await writeFile(new URL('catalog.json',destination),catalog);
console.log('APK assets prepared: '+JSON.parse(catalog).songs.length+' songs · '+fileURLToPath(destination));
