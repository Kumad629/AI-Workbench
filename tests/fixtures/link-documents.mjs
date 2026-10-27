export function pdfBytes(pages=['Revenue 120; gross margin 42.5%.','Operating cash flow 80; net income 25.']){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',''];
 const kids=[];
 for(const text of pages){const pageId=objects.length+1,streamId=pageId+1;kids.push(pageId+' 0 R');const stream='BT /F1 12 Tf 50 740 Td ('+text.replace(/[()\\]/g,'\\$&')+') Tj ET';objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents '+streamId+' 0 R >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream');}
 objects[1]='<< /Type /Pages /Count '+pages.length+' /Kids ['+kids.join(' ')+'] >>';let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const xref=Buffer.byteLength(pdf);pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(pdf);
}
