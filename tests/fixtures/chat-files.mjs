import {zipSync,strToU8} from 'fflate';
import * as XLSX from 'xlsx';
import {writePptContent} from 'ppt-codec';
const zip=files=>zipSync(Object.fromEntries(Object.entries(files).map(([key,value])=>[key,strToU8(value)])));
export const documentText='季度收入增长，需要核实现金流。';
export function docxBytes(){return zip({
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
 'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+documentText+'</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>指标</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>本季</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>收入</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>120</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:del><w:r><w:t>已删除的草稿</w:t></w:r></w:del><w:r><w:instrText>DDE 非正文域代码</w:instrText></w:r></w:p></w:body></w:document>',
 'word/footer1.xml':'<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>来源：公开季度报告</w:t></w:r></w:p></w:ftr>',
 'word/footnotes.xml':'<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>注：口径保持一致。</w:t></w:r></w:p></w:footnote></w:footnotes>'
});}
export function pptxBytes(){const slide=text=>'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>'+text+'</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';return zip({
 'ppt/presentation.xml':'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rIdB"/><p:sldId id="257" r:id="rIdA"/></p:sldIdLst></p:presentation>',
 'ppt/_rels/presentation.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdA" Target="slides/slide1.xml"/><Relationship Id="rIdB" Target="slides/slide2.xml"/></Relationships>',
 'ppt/slides/slide1.xml':slide('第二页：风险及待核实事项'),
 'ppt/slides/slide2.xml':slide('第一页：'+documentText),
 'ppt/slides/_rels/slide2.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="notes" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="image" Target="https://example.invalid/private.png" TargetMode="External"/></Relationships>',
 'ppt/notesSlides/notesSlide1.xml':'<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>备注：核对披露原文。</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>999</a:t></a:r></a:p></p:txBody></p:sp></p:notes>'
});}
export function spreadsheetBytes(bookType='xlsx'){
 const wb=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['指标','本季','同比'],['收入',120,.125],['现金流',80,.05]]);sheet.C2.z='0.0%';sheet.D2={t:'n',v:200,f:'SUM(B2:B3)'};sheet['!ref']='A1:D3';sheet['!merges']=[XLSX.utils.decode_range('A5:B5')];XLSX.utils.book_append_sheet(wb,sheet,'业绩');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['下季跟踪','回款进度']]),'隐藏备忘');wb.Workbook={Sheets:[{name:'业绩',Hidden:0},{name:'隐藏备忘',Hidden:1}]};return XLSX.write(wb,{type:'buffer',bookType});
}
export function legacyPptBytes(){const p=text=>({kind:'paragraph',runs:[{text}]});return writePptContent({metadata:{title:'本地读取测试'},slides:['旧版第一页：收入120','旧版第二页：现金流80'].map((text,i)=>({size:{widthPt:720,heightPt:540},shapes:[{frame:{xPt:20,yPt:20,widthPt:400,heightPt:100},blocks:[p(text)]}],notes:i===0?'旧版演讲备注':''}))});}
