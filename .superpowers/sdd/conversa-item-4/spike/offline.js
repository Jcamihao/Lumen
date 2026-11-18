const path=require('path'),fs=require('fs'),sharp=require('sharp');const {createWorker}=require('tesseract.js');
(async()=>{
  const net=require('net');const s=net.connect(80,'1.1.1.1');let reachable=await new Promise(r=>{s.on('connect',()=>r(true));s.on('error',()=>r(false));setTimeout(()=>r(false),2500)});s.destroy();
  console.log('rede alcançável neste processo:',reachable);
  const mk=async()=>{const w=await createWorker('por',1,{langPath:path.join(__dirname,'node_modules/@tesseract.js-data/por/4.0.0_best_int'),gzip:true,cachePath:'/tmp/claude-1001/tess-cache2'});await w.setParameters({tessedit_pageseg_mode:'6'});return w;};
  const files=fs.readdirSync('samples').filter(f=>/\.clean\.png$/.test(f)).map(f=>'samples/'+f);
  const w1=await mk(),w2=await mk();
  const t0=Date.now();
  await Promise.all([ (async()=>{for(const f of files.slice(0,4))await w1.recognize(fs.readFileSync(f))})(), (async()=>{for(const f of files.slice(4,8))await w2.recognize(fs.readFileSync(f))})() ]);
  console.log('2 workers em paralelo, 8 notas:',Date.now()-t0,'ms; rss MB',Math.round(process.memoryUsage().rss/1e6),'; heap MB',Math.round(process.memoryUsage().heapUsed/1e6));
  await w1.terminate();await w2.terminate();
  // limite de megapixels
  const big=await sharp({create:{width:6000,height:6000,channels:3,background:'#fff'}}).png().toBuffer();
  try{await sharp(big,{limitInputPixels:25e6}).metadata().then(m=>console.log('metadata ok',m.width,m.height));await sharp(big,{limitInputPixels:25e6}).resize({width:1000}).toBuffer();console.log('36MP aceito (ruim)');}catch(e){console.log('36MP recusado:',e.message)}
  try{await sharp(Buffer.from('nao e imagem')).metadata();}catch(e){console.log('lixo recusado:',e.message.slice(0,60))}
})().catch(e=>{console.error('ERRO',e.message);process.exit(1)});
