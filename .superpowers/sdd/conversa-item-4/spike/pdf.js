const fs=require('fs'),path=require('path'),PDFDocument=require('pdfkit');
const truth=JSON.parse(fs.readFileSync('samples/truth.json','utf8'));
const money=n=>n.toFixed(2).replace('.',',');
(async()=>{
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  let ok=0,keyOk=0,itemsOk=0,itemsAll=0,ms=0;
  for(const t of truth){
    const file=`samples/${t.name}.pdf`;
    const doc=new PDFDocument({size:[300,700],margin:10});const out=fs.createWriteStream(file);doc.pipe(out);
    doc.font('Courier').fontSize(7);
    const lines=[t.merchant,`CNPJ: ${t.cnpj}`,'DANFE NFC-e',...t.items.map((it,i)=>`${String(i+1).padStart(3,'0')} ${it.desc} ${it.qty} ${it.un} ${money(it.unit)} ${money(it.total)}`),`VALOR TOTAL R$ ${money(t.total)}`,`NFC-e n. ${t.nf} ${t.date}`,'CHAVE DE ACESSO',t.key.slice(0,22),t.key.slice(22)];
    lines.forEach(l=>doc.text(l));doc.end();await new Promise(r=>out.on('finish',r));
    const t0=Number(process.hrtime.bigint()/1000000n);
    const data=new Uint8Array(fs.readFileSync(file));
    const pdf=await pdfjs.getDocument({data,useSystemFonts:true,isEvalSupported:false,disableFontFace:true}).promise;
    let text='';for(let p=1;p<=Math.min(pdf.numPages,3);p++){const pg=await pdf.getPage(p);const c=await pg.getTextContent();text+=c.items.map(i=>i.str+(i.hasEOL?'\n':'')).join('')+'\n';}
    ms+=Number(process.hrtime.bigint()/1000000n)-t0;
    const tot=text.match(/VALOR TOTAL R\$\s*([\d.]+,\d{2})/);
    if(tot&&tot[1]===money(t.total))ok++;
    const after=text.split(/CHAVE DE ACESSO/).pop().replace(/\D/g,'');if(after.slice(0,44)===t.key)keyOk++;
    for(const it of t.items){itemsAll++;if(text.includes(money(it.total)))itemsOk++;}
  }
  console.log(`PDF texto: total ${ok}/${truth.length}, chave ${keyOk}/${truth.length}, valores de itens presentes ${itemsOk}/${itemsAll}, ${Math.round(ms/truth.length)}ms/pdf`);
})().catch(e=>{console.error(e.message);process.exit(1)});
