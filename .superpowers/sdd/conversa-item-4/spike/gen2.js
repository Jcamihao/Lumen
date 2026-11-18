const fs=require('fs'),path=require('path'),sharp=require('sharp');
const dir=path.join(__dirname,'samples');let seed=7;const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
(async()=>{
for(const f of fs.readdirSync(dir).filter(x=>/^n\d+\.clean\.png$/.test(x))){
  const name=f.split('.')[0];const base=fs.readFileSync(path.join(dir,f));
  // ruido gaussiano aproximado
  const {data,info}=await sharp(base).flatten({background:'#fff'}).greyscale().raw().toBuffer({resolveWithObject:true});
  const noisy=Buffer.from(data);for(let i=0;i<noisy.length;i++){noisy[i]=Math.max(0,Math.min(255,noisy[i]+Math.round((rnd()+rnd()+rnd()-1.5)*90)));}
  fs.writeFileSync(path.join(dir,`${name}.noise.png`),await sharp(noisy,{raw:{width:info.width,height:info.height,channels:1}}).png().toBuffer());
  // tinta apagada: faixas claras + contraste baixo
  const faded=Buffer.from(data);for(let y=0;y<info.height;y++){const fade=(Math.sin(y/37)+1)/2*0.55;for(let x=0;x<info.width;x++){const i=y*info.width+x;faded[i]=Math.round(faded[i]+(255-faded[i])*fade);}}
  fs.writeFileSync(path.join(dir,`${name}.fade.png`),await sharp(faded,{raw:{width:info.width,height:info.height,channels:1}}).png().toBuffer());
  fs.writeFileSync(path.join(dir,`${name}.blur2.png`),await sharp(base).blur(2.4).png().toBuffer());
  fs.writeFileSync(path.join(dir,`${name}.tiny.jpg`),await sharp(base).resize({width:380}).blur(0.9).jpeg({quality:28}).toBuffer());
  fs.writeFileSync(path.join(dir,`${name}.rot-shadow.jpg`),await sharp(base).rotate(5,{background:'#d0d0d0'}).linear(0.8,-10).blur(0.7).jpeg({quality:45}).toBuffer());
}
console.log(fs.readdirSync(dir).length,'arquivos');})();
