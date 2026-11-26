import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Icon } from "./icons";
import type { Lang } from "../core/i18n";
import type { Plan } from "../core/types";
import { getPlanLimits } from "../core/entitlements";
import { createWorkspaceId, loadWorkspaceItem, saveWorkspaceItem } from "../core/local-workspace";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
import { inspectZipArchive } from "../core/zip-safety.js";

type Props = { t: (key: string) => string; lang: Lang; plan: Plan; savedItemId?: string | null; onSavedItemLoaded?: () => void };
type Grid = string[][];
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 5_000;
const MAX_COLS = 200;
const MAX_CELLS = MAX_ROWS * MAX_COLS;
const MAX_ZIP_UNCOMPRESSED = 160 * 1024 * 1024;
const MAX_HISTORY = 20;
const MAX_HISTORY_CHARS = 1_000_000;
const XML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function escapeXml(s: string): string { return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;"); }
function colName(n: number): string { let out=""; while(n>0){ const r=(n-1)%26; out=String.fromCharCode(65+r)+out; n=Math.floor((n-1)/26); } return out; }
function colIndex(s: string): number { let n=0; for(const c of s.toUpperCase()){n=n*26+c.charCodeAt(0)-64;} return n; }
function cloneGrid(grid: Grid): Grid { return grid.map(row => [...row]); }
function gridSize(grid: Grid): number { return grid.reduce((n,row)=>n+row.reduce((m,value)=>m+value.length,0),0); }
function csvParse(text: string, delimiter = ",", maxRows = MAX_ROWS, maxCols = MAX_COLS): Grid {
  const rows: Grid=[]; let row:string[]=[], field="", quoted=false;
  for(let i=0;i<text.length;i++){ const c=text[i]; if(quoted){ if(c==='"'&&text[i+1]==='"'){field+='"';i++;} else if(c==='"') quoted=false; else field+=c; }
    else if(c==='"'&&field.length===0) quoted=true; else if(c===delimiter){row.push(field);field="";} else if(c==="\n"){row.push(field.replace(/\r$/, ""));rows.push(row);row=[];field="";} else field+=c; }
  if(field.length||row.length){row.push(field.replace(/\r$/, ""));rows.push(row);} return clampGrid(rows, maxRows, maxCols);
}
function clampGrid(rows: Grid, maxRows = MAX_ROWS, maxCols = MAX_COLS): Grid { const width=Math.min(maxCols,Math.max(1,...rows.map(r=>r.length))); return rows.slice(0,maxRows).map(r=>Array.from({length:width},(_,i)=>(r[i]??"").slice(0,5000))); }
function checkZipSize(bytes: Uint8Array, maxUncompressedBytes = MAX_ZIP_UNCOMPRESSED): void {
  inspectZipArchive(bytes, maxUncompressedBytes, {
    invalid: "excel_bad_file",
    tooLarge: "excel_zip_too_large",
    tooManyEntries: "excel_too_many_archive_entries",
    zip64: "excel_bad_file",
  });
}

function parseXlsx(bytes: Uint8Array, maxRows = MAX_ROWS, maxCols = MAX_COLS, maxUncompressedBytes = MAX_ZIP_UNCOMPRESSED): {grid:Grid;sheet:string} {
  checkZipSize(bytes, maxUncompressedBytes);
  const files=unzipSync(bytes); const read=(name:string)=>files[name]?strFromU8(files[name]):"";
  const workbook=new DOMParser().parseFromString(read("xl/workbook.xml"),"application/xml"); if(workbook.querySelector("parsererror")) throw new Error("excel_bad_file");
  const rels=new DOMParser().parseFromString(read("xl/_rels/workbook.xml.rels"),"application/xml");
  const sheet=workbook.getElementsByTagNameNS(XML,"sheet")[0]; if(!sheet) throw new Error("excel_no_sheet");
  const sheetName=sheet.getAttribute("name")||"Sheet1", rid=sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id")||sheet.getAttribute("r:id")||"";
  const rel=Array.from(rels.getElementsByTagName("Relationship")).find(x=>x.getAttribute("Id")===rid); if(!rel) throw new Error("excel_bad_file");
  let target=rel.getAttribute("Target")||"worksheets/sheet1.xml";
  if(target.startsWith("/")) target=target.slice(1); else target="xl/"+target;
  const normalized:string[]=[]; for(const part of target.split("/")){if(part==="..")normalized.pop();else if(part!=="."&&part)normalized.push(part);} target=normalized.join("/");
  if(!target.startsWith("xl/")) throw new Error("excel_bad_file");
  const ssDoc=new DOMParser().parseFromString(read("xl/sharedStrings.xml"),"application/xml");
  const shared=Array.from(ssDoc.getElementsByTagNameNS(XML,"si")).map(si=>Array.from(si.getElementsByTagNameNS(XML,"t")).map(t=>t.textContent||"").join(""));
  const doc=new DOMParser().parseFromString(read(target),"application/xml"); if(doc.querySelector("parsererror")) throw new Error("excel_bad_file");
  const rows:Grid=[];
  for(const rowEl of Array.from(doc.getElementsByTagNameNS(XML,"row"))){ const r=Number(rowEl.getAttribute("r")||rows.length+1); if(r<1||r>maxRows) continue; const row:string[]=[];
    for(const cell of Array.from(rowEl.getElementsByTagNameNS(XML,"c"))){const ref=cell.getAttribute("r")||"A1", letters=ref.match(/^[A-Z]+/i)?.[0]||"A", ci=colIndex(letters); if(ci<1||ci>maxCols)continue; const type=cell.getAttribute("t"), v=cell.getElementsByTagNameNS(XML,"v")[0]?.textContent||"";
      let value=v; if(type==="s") value=shared[Number(v)]??""; else if(type==="inlineStr") value=Array.from(cell.getElementsByTagNameNS(XML,"t")).map(x=>x.textContent||"").join("");
      const formula=cell.getElementsByTagNameNS(XML,"f")[0]?.textContent; if(formula) value="="+formula;
      row[ci-1]=value; }
    rows[r-1]=row;
  }
  if(rows.length*maxCols>maxRows*maxCols) throw new Error("excel_limit");
  return {grid:clampGrid(Array.from({length: rows.length}, (_, i) => rows[i] ?? []), maxRows, maxCols),sheet:sheetName};
}

function formulaTokens(expression: string): string[] | null {
  const compact = expression.replace(/\s+/g, "").toUpperCase();
  const tokens = compact.match(/[A-Z]{1,3}\d+|\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  return tokens.join("") === compact && tokens.length ? tokens : null;
}
function safeFormula(f: string): boolean {
  const expression = f.trim();
  if (/^(SUM|AVERAGE|MIN|MAX|COUNT|COUNTA|PRODUCT)\([A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?\)$/i.test(expression)) return true;
  return formulaTokens(expression) !== null;
}
export function evaluateCell(row: number, col: number, grid: Grid, stack = new Set<string>()): string {
  if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) return "0";
  const ref = `${colName(col + 1)}${row + 1}`;
  if (stack.has(ref)) return "#CIRCULAR!";
  const raw = grid[row]?.[col] ?? "";
  if (!raw.startsWith("=")) return raw;
  const nextStack = new Set(stack); nextStack.add(ref);
  return evaluateFormula(raw.slice(1), grid, nextStack);
}
function evaluateFormula(expression: string, grid: Grid, stack: Set<string>): string {
  const f = expression.trim();
  const fn = f.match(/^(SUM|AVERAGE|MIN|MAX|COUNT|COUNTA|PRODUCT)\(([A-Z]{1,3}\d+)(?::([A-Z]{1,3}\d+))?\)$/i);
  if (fn) {
    const start = fn[2].match(/^([A-Z]+)(\d+)$/i)!;
    const end = (fn[3] ?? fn[2]).match(/^([A-Z]+)(\d+)$/i)!;
    const c1 = colIndex(start[1]), r1 = Number(start[2]), c2 = colIndex(end[1]), r2 = Number(end[2]);
    if (Math.abs(c2-c1) * Math.abs(r2-r1) > MAX_CELLS) return "#RANGE!";
    const cells: string[] = [];
    for (let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++) for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++) cells.push(evaluateCell(r-1,c-1,grid,stack));
    const error = cells.find(v => /^#(?:CIRCULAR|DIV\/0|FORMULA|REF|RANGE)!$/.test(v)); if (error) return error;
    if (fn[1].toUpperCase()==="COUNTA") return String(cells.filter(v=>v.trim()!=="").length);
    const nums = cells.filter(v=>v.trim()!=="" && Number.isFinite(Number(v))).map(Number);
    const op=fn[1].toUpperCase();
    if(op==="COUNT") return String(nums.length);
    if(!nums.length) return "0";
    const total=nums.reduce((a,b)=>a+b,0);
    const value=op==="SUM"?total:op==="AVERAGE"?total/nums.length:op==="MIN"?Math.min(...nums):op==="MAX"?Math.max(...nums):nums.reduce((a,b)=>a*b,1);
    return Number.isFinite(value)?String(Number(value.toFixed(8))):"#DIV/0!";
  }
  if (!safeFormula(f)) return "#FORMULA?";
  // A closure-safe, non-null token array keeps strict TypeScript checks happy
  // inside the recursive parser functions below. Empty means invalid formula.
  const tokens: string[] = formulaTokens(f) ?? []; if (tokens.length === 0) return "#FORMULA?";
  let i=0;
  function primary():number {
    const token=tokens[i++];
    if(token==="("){const v=addition();if(tokens[i++]!==")")throw new Error("syntax");return v;}
    if(token==="-")return -primary();
    if(token==="+")return primary();
    if(/^\d/.test(token||""))return Number(token);
    if(/^[A-Z]{1,3}\d+$/i.test(token||"")){const m=token.match(/^([A-Z]+)(\d+)$/i)!;const value=evaluateCell(Number(m[2])-1,colIndex(m[1])-1,grid,stack);if(value.startsWith("#"))throw new Error(value);return Number(value)||0;}
    throw new Error("syntax");
  }
  function multiplication():number {let v=primary();while(tokens[i]==="*"||tokens[i]==="/"){const op=tokens[i++],right=primary();if(op==="/"&&right===0)throw new Error("#DIV/0!");v=op==="*"?v*right:v/right;}return v;}
  function addition():number {let v=multiplication();while(tokens[i]==="+"||tokens[i]==="-"){const op=tokens[i++],right=multiplication();v=op==="+"?v+right:v-right;}return v;}
  try {const value=addition();if(i!==tokens.length) return "#FORMULA?";return Number.isFinite(value)?String(Number(value.toFixed(8))):"#DIV/0!";} catch(e){const message=e instanceof Error?e.message:"";return message.startsWith("#")?message:"#FORMULA?";}
}
export function xlsxBuild(grid:Grid,sheetName:string):Uint8Array {
  const rows=grid.map((row,ri)=>`<row r="${ri+1}">${row.map((value,ci)=>{if(!value)return "";const ref=`${colName(ci+1)}${ri+1}`; if(value.startsWith("=") && safeFormula(value.slice(1))){const formula=value.slice(1);const evaluated=evaluateCell(ri,ci,grid);const cached=Number.isFinite(Number(evaluated))?`<v>${Number(evaluated)}</v>`:"<v></v>";return `<c r="${ref}"><f>${escapeXml(formula)}</f>${cached}</c>`;} if(/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))return `<c r="${ref}"><v>${value.trim()}</v></c>`;return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;}).join("")}</row>`).join("");
  const safeName=escapeXml(sheetName.replace(/[\\\/*?:\[\]]/g,"_").slice(0,31)||"Sheet1");
  const entries:{[key:string]:Uint8Array}={
    "[Content_Types].xml":strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels":strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml":strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${XML}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>`),
    "xl/_rels/workbook.xml.rels":strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml":strToU8(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${XML}"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`),
    "xl/worksheets/sheet1.xml":strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${XML}"><sheetData>${rows}</sheetData></worksheet>`)
  };
  return zipSync(entries,{level:6});
}

export default function ExcelWorkspace({t,lang,plan,savedItemId,onSavedItemLoaded}:Props){
  const allPlanLimits = getPlanLimits(plan);
  const planLimits = allPlanLimits.excel;
  const workspaceLimits = allPlanLimits.workspace;
  const recordId=useRef(createWorkspaceId());const hydrating=useRef(false);const [localSavedAt,setLocalSavedAt]=useState(0);
  const input=useRef<HTMLInputElement>(null);
  const gridRef=useRef<Grid>([["","",""],["","",""],["","",""]]);
  const undoRef=useRef<Grid[]>([]), redoRef=useRef<Grid[]>([]);
  const [grid,setGrid]=useState<Grid>(gridRef.current);
  const [name,setName]=useState("Sheet1");const [fileName,setFileName]=useState("Workbook");
  const [dirty,setDirty]=useState(false);const [status,setStatus]=useState("");const [error,setError]=useState("");
  const [selected,setSelected]=useState<[number,number]>([0,0]);const [search,setSearch]=useState("");const [editingCell,setEditingCell]=useState<string|null>(null);const [firstRowHeader,setFirstRowHeader]=useState(true);
  const width=Math.max(3,...grid.map(r=>r.length));
  const rows=useMemo(()=>clampGrid(grid.map(r=>Array.from({length:width},(_,i)=>r[i]||"")),planLimits.maxRows,planLimits.maxColumns),[grid,width,planLimits.maxRows,planLimits.maxColumns]);
  const visibleWidth=Math.max(3,...rows.map(row=>row.length));
  const exceedsPlan=useMemo(()=>{
    const payloadBytes=new TextEncoder().encode(JSON.stringify({grid,name,fileName,firstRowHeader})).byteLength;
    return grid.length>planLimits.maxRows || grid.some(row=>row.length>planLimits.maxColumns) || payloadBytes>workspaceLimits.maxRecordBytes;
  },[grid,name,fileName,firstRowHeader,planLimits.maxRows,planLimits.maxColumns,workspaceLimits.maxRecordBytes]);
  useEffect(()=>{
    if(!savedItemId)return;let cancelled=false;hydrating.current=true;
    loadWorkspaceItem<{grid?:Grid;name?:string;fileName?:string;firstRowHeader?:boolean}>(savedItemId).then(item=>{
      if(cancelled||!item||item.kind!=="excel"||!Array.isArray(item.payload.grid))return;
      const restored=clampGrid(item.payload.grid,MAX_ROWS,MAX_COLS);recordId.current=item.id;gridRef.current=restored;setGrid(restored);setName(typeof item.payload.name==="string"?item.payload.name:"Sheet1");setFileName(typeof item.payload.fileName==="string"?item.payload.fileName:item.name);setFirstRowHeader(item.payload.firstRowHeader!==false);undoRef.current=[];redoRef.current=[];setSelected([0,0]);setEditingCell(null);setDirty(false);setLocalSavedAt(item.updatedAt);setStatus(lang==="fa"?"صفحه‌گسترده محلی بازیابی شد.":"Local spreadsheet restored.");
    }).catch(()=>setError(lang==="fa"?"بازیابی فایل محلی ناموفق بود.":"Could not restore the local workbook.")).finally(()=>{hydrating.current=false;onSavedItemLoaded?.();});
    return()=>{cancelled=true;};
  },[savedItemId]);
  useEffect(()=>{
    if(!dirty||hydrating.current||exceedsPlan)return;const timer=window.setTimeout(()=>{
      void saveWorkspaceItem("excel",fileName,{grid:rows,name,fileName,firstRowHeader},recordId.current).then(item=>{setLocalSavedAt(item.updatedAt);setDirty(false);}).catch(error=>setStatus(error instanceof Error&&error.message==="workspace_plan_limit"?(lang==="fa"?"ظرفیت ذخیره خودکار پلن فعلی تکمیل شده؛ پیش‌نویس‌های موجود حذف نشده‌اند. چند مورد را حذف کنید یا پلن Pro را بررسی کنید.":"The current plan workspace quota is full. Existing drafts were kept; delete drafts or consider Pro."):(lang==="fa"?"ذخیره خودکار ناموفق بود؛ فایل XLSX را دانلود کنید.":"Autosave failed; please export an XLSX backup.")));
    },800);return()=>window.clearTimeout(timer);
  },[dirty,rows,name,fileName,firstRowHeader,lang,exceedsPlan]);
  function saveHistory(current:Grid,clearRedo=true){const size=gridSize(current);if(size>250000){undoRef.current=[];if(clearRedo)redoRef.current=[];return;}undoRef.current.push(cloneGrid(current));if(undoRef.current.length>MAX_HISTORY)undoRef.current.shift();while(undoRef.current.reduce((n,g)=>n+gridSize(g),0)>MAX_HISTORY_CHARS)undoRef.current.shift();if(clearRedo)redoRef.current=[];}
  function commitGrid(next:Grid,record=true){if(exceedsPlan)return;if(record)saveHistory(gridRef.current);const bounded=clampGrid(next,planLimits.maxRows,planLimits.maxColumns);gridRef.current=bounded;setGrid(bounded);setDirty(true);setStatus("");}
  function resetGrid(next:Grid){const bounded=clampGrid(next,planLimits.maxRows,planLimits.maxColumns);gridRef.current=bounded;setGrid(bounded);undoRef.current=[];redoRef.current=[];setDirty(false);setSelected([0,0]);setEditingCell(null);}
  function undo(){const previous=undoRef.current.pop();if(!previous)return;redoRef.current.push(cloneGrid(gridRef.current));gridRef.current=previous;setGrid(previous);setDirty(true);setStatus(t("excelUndoDone"));}
  function redo(){const next=redoRef.current.pop();if(!next)return;saveHistory(gridRef.current,false);gridRef.current=next;setGrid(next);setDirty(true);setStatus(t("excelRedoDone"));}
  async function openFile(file?:File){if(!file)return;setError("");setStatus("");try{if(file.size>planLimits.maxFileBytes)throw new Error("excel_file_large");const ext=file.name.split(".").pop()?.toLowerCase();let parsed:Grid,sheet="Sheet1";if(ext==="csv"||ext==="tsv"){parsed=csvParse(await file.text(),ext==="tsv"?"\t":",",planLimits.maxRows,planLimits.maxColumns);}else if(ext==="xlsx"){const result=parseXlsx(new Uint8Array(await file.arrayBuffer()),planLimits.maxRows,planLimits.maxColumns,planLimits.maxUncompressedBytes);parsed=result.grid;sheet=result.sheet;}else throw new Error("excel_unsupported");recordId.current=createWorkspaceId();resetGrid(parsed.length?parsed:[["",""]]);setName(sheet);setFileName(file.name.replace(/\.[^.]+$/," ").trim().slice(0,100)||"Workbook");setDirty(true);setStatus(t("excelOpened"));}catch(e){setError(t(e instanceof Error&&e.message.startsWith("excel_")?e.message:"excel_open_failed"));}finally{if(input.current)input.current.value="";}}
  function update(r:number,c:number,value:string){if(exceedsPlan)return;const next=cloneGrid(gridRef.current);while(next.length<=r)next.push([]);next[r][c]=value;commitGrid(next);}
  function addRow(){if(gridRef.current.length>=planLimits.maxRows){setError(t("excelLimit"));return;}commitGrid([...gridRef.current,Array(width).fill("")]);}
  function addCol(){if(width>=planLimits.maxColumns){setError(t("excelLimit"));return;}commitGrid(gridRef.current.map(row=>[...row,""]));}
  function deleteRow(){if(gridRef.current.length<=1){setError(t("excelKeepOne"));return;}const next=gridRef.current.filter((_,i)=>i!==selected[0]);commitGrid(next);setSelected([Math.max(0,selected[0]-1),selected[1]]);}
  function deleteCol(){if(width<=1){setError(t("excelKeepOne"));return;}const next=gridRef.current.map(row=>row.filter((_,i)=>i!==selected[1]));commitGrid(next);setSelected([selected[0],Math.max(0,selected[1]-1)]);}
  function moveCell(r:number,c:number){if(exceedsPlan)return;const nr=Math.max(0,Math.min(planLimits.maxRows-1,r)),nc=Math.max(0,Math.min(planLimits.maxColumns-1,c));if(nr>=gridRef.current.length){const next=cloneGrid(gridRef.current);while(next.length<=nr)next.push(Array(width).fill(""));commitGrid(next);}if(nc>=width){const next=cloneGrid(gridRef.current);for(const row of next)while(row.length<=nc)row.push("");commitGrid(next);}setSelected([nr,nc]);setEditingCell(null);requestAnimationFrame(()=>document.getElementById(`excel-cell-${colName(nc+1)}${nr+1}`)?.focus());}
  function handleKeyDown(e:KeyboardEvent<HTMLInputElement>,r:number,c:number){if(exceedsPlan)return;if(e.key==="Enter"){e.preventDefault();moveCell(r+(e.shiftKey?-1:1),c);}else if(e.key==="Tab"){e.preventDefault();moveCell(r,c+(e.shiftKey?-1:1));}}
  function pasteBlock(e:ClipboardEvent<HTMLInputElement>,startRow:number,startCol:number){if(exceedsPlan){e.preventDefault();return;}const value=e.clipboardData.getData("text/plain");if(!/[\t\n]/.test(value))return;e.preventDefault();const pasted=csvParse(value,"\t",planLimits.maxRows,planLimits.maxColumns);if(startRow+pasted.length>planLimits.maxRows||startCol+Math.max(...pasted.map(r=>r.length))>planLimits.maxColumns){setError(t("excelLimit"));return;}const next=cloneGrid(gridRef.current);while(next.length<startRow+pasted.length)next.push([]);pasted.forEach((row,ri)=>row.forEach((cell,ci)=>{next[startRow+ri][startCol+ci]=cell;}));commitGrid(next);setStatus(t("excelPasted"));}
  function autoSum(){const [r,c]=selected;let start=r-1,end=r-1;while(start>=0&&(gridRef.current[start]?.[c]??"").trim()!=="")start--;if(start===r-1){start=r+1;end=start;while(end<gridRef.current.length&&(gridRef.current[end]?.[c]??"").trim()!=="")end++;end--;}else start++;if(start>end||start<0||end>=planLimits.maxRows){setError(t("excelAutoSumHint"));return;}const formula=`=SUM(${colName(c+1)}${start+1}:${colName(c+1)}${end+1})`;update(r,c,formula);setStatus(`${t("excelFormulaInserted")}: ${formula}`);}
  function sortColumn(direction:"asc"|"desc"){const col=selected[1];const next=cloneGrid(gridRef.current);const header=firstRowHeader?next.slice(0,1):[];const data=firstRowHeader?next.slice(1):next;data.sort((a,b)=>{const av=(a[col]??"").trim(),bv=(b[col]??"").trim();if(!av)return 1;if(!bv)return -1;const an=Number(av),bn=Number(bv);const cmp=av!==""&&bv!==""&&Number.isFinite(an)&&Number.isFinite(bn)?an-bn:av.localeCompare(bv,lang==="fa"?"fa":"en",{numeric:true,sensitivity:"base"});return direction==="asc"?cmp:-cmp;});commitGrid([...header,...data]);}
  function exportXlsx(){try{const exportRows=exceedsPlan?clampGrid(grid,MAX_ROWS,MAX_COLS):rows;const bytes=xlsxBuild(exportRows,name);download(bytes,`${safeName(fileName)}.xlsx`,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");setDirty(true);setStatus(t("excelSaved"));}catch{setError(t("excelExportFailed"));}}
  function exportCsv(){const exportRows=exceedsPlan?clampGrid(grid,MAX_ROWS,MAX_COLS):rows;const csv=exportRows.map((row,r)=>row.map((v,c)=>{const s=v.startsWith("=")?evaluateCell(r,c,exportRows):v;return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}).join(",")).join("\r\n");download(new TextEncoder().encode("\ufeff"+csv),`${safeName(fileName)}.csv`,"text/csv;charset=utf-8");setStatus(t("excelCsvSaved"));}
  function download(bytes:Uint8Array,filename:string,mime:string){const owned=new ArrayBuffer(bytes.byteLength);new Uint8Array(owned).set(bytes);void saveBlobToDeviceOrDownload(new Blob([owned],{type:mime}),filename);}
  function safeName(s:string){return s.replace(/[\\/:*?"<>|]/g,"-").trim().slice(0,90)||"Workbook";}
  const matches=search.trim()?rows.flatMap((row,r)=>row.map((v,c)=>v.toLowerCase().includes(search.toLowerCase())?`${colName(c+1)}${r+1}`:"").filter(Boolean)).filter(Boolean):[];
  const rangeHint = t("excelFormulaHint");
  return <section className="excel-page">
    {exceedsPlan&&<div className="plan-over-limit-note" role="status"><Icon name="lock" size={16}/><span>{lang==="fa"?"این صفحه‌گسترده با سقف بالاتر Pro ساخته شده است. داده‌های کامل حفظ شده‌اند و می‌توانید خروجی بگیرید؛ برای ویرایش در سقف کامل، Pro را فعال کنید یا یک نسخه کوچک‌تر بسازید.":"This workbook was created with higher Pro limits. All data is preserved and can be exported; upgrade to Pro or create a smaller copy to continue editing."}</span></div>}
    <div className="excel-intro"><div className="excel-icon"><Icon name="excel" size={28}/></div><div><h2>{t("excelTitle")}</h2><p className="muted">{t("excelIntro")}</p><p className="small muted">{lang === "fa" ? `سقف پلن ${plan === "pro" ? "Pro" : "Free"}: ${planLimits.maxRows.toLocaleString("fa-IR")} ردیف × ${planLimits.maxColumns.toLocaleString("fa-IR")} ستون · ${Math.round(planLimits.maxFileBytes / 1048576)} مگابایت.` : `${plan === "pro" ? "Pro" : "Free"} limit: ${planLimits.maxRows.toLocaleString()} rows × ${planLimits.maxColumns.toLocaleString()} columns · ${Math.round(planLimits.maxFileBytes / 1048576)} MB.`}</p><p className="excel-privacy"><Icon name="shield" size={15}/>{t("excelPrivacy")}</p></div></div>
    <div className="excel-filebar"><div className="excel-actions"><button className="primary" onClick={()=>input.current?.click()}><Icon name="upload" size={16}/>{t("excelOpen")}</button><button onClick={()=>{recordId.current=createWorkspaceId();resetGrid(Array.from({length:10},()=>Array(6).fill("")));setName("Sheet1");setFileName("Workbook");setDirty(true);setError("");}}><Icon name="plus" size={16}/>{t("excelNew")}</button><input ref={input} hidden type="file" accept=".xlsx,.csv,.tsv" onChange={e=>openFile(e.target.files?.[0])}/></div><label>{t("excelBookName")}<input value={fileName} maxLength={100} readOnly={exceedsPlan} onChange={e=>{setFileName(e.target.value);setDirty(true);}}/></label></div>
    <div className="excel-formula-bar"><strong>{colName(selected[1]+1)}{selected[0]+1}</strong><span>fx</span><input aria-label={t("excelFormulaBar")} readOnly={exceedsPlan} value={grid[selected[0]]?.[selected[1]]??""} onChange={e=>update(selected[0],selected[1],e.target.value)}/></div>
    <p className="excel-formula-hint">{rangeHint}</p>
    <div className="excel-toolbar"><button onClick={addRow} disabled={exceedsPlan}>{t("excelAddRow")}</button><button onClick={addCol} disabled={exceedsPlan}>{t("excelAddCol")}</button><button onClick={deleteRow} disabled={exceedsPlan}>{t("excelDeleteRow")}</button><button onClick={deleteCol} disabled={exceedsPlan}>{t("excelDeleteCol")}</button><button className="primary" onClick={autoSum} disabled={exceedsPlan}>{t("excelAutoSum")}</button><button onClick={undo} disabled={exceedsPlan || !undoRef.current.length}>{t("excelUndo")}</button><button onClick={redo} disabled={exceedsPlan || !redoRef.current.length}>{t("excelRedo")}</button><label className="excel-search"><Icon name="search" size={15}/><input value={search} placeholder={t("excelSearch")} onChange={e=>setSearch(e.target.value)}/></label><span>{t("excelFound").replace("{n}",String(matches.length))}</span></div>
    <div className="excel-sortbar"><span>{t("excelSortBySelected")}</span><button onClick={()=>sortColumn("asc")} disabled={exceedsPlan}>{t("excelSortAsc")}</button><button onClick={()=>sortColumn("desc")} disabled={exceedsPlan}>{t("excelSortDesc")}</button><label className="excel-header-toggle"><input type="checkbox" disabled={exceedsPlan} checked={firstRowHeader} onChange={e=>{setFirstRowHeader(e.target.checked);setDirty(true);}}/>{t("excelFirstRowHeader")}</label><span className="muted">{t("excelPasteHint")}</span></div>
    <div className="excel-grid-wrap"><table className="excel-grid"><thead><tr><th className="excel-corner">#</th>{Array.from({length:visibleWidth},(_,c)=><th key={c}>{colName(c+1)}</th>)}</tr></thead><tbody>{rows.map((row,r)=><tr key={r}><th>{r+1}</th>{row.map((value,c)=>{const ref=`${colName(c+1)}${r+1}`;const display=value.startsWith("=")&&editingCell!==ref?evaluateCell(r,c,rows):value;return <td key={c} className={search&&value.toLowerCase().includes(search.toLowerCase())?"excel-match":""}><input id={`excel-cell-${ref}`} aria-label={ref} value={display} readOnly={exceedsPlan} title={value.startsWith("=")?`${value} → ${evaluateCell(r,c,rows)}`:undefined} onFocus={()=>{setSelected([r,c]);setEditingCell(ref);}} onBlur={()=>setEditingCell(current=>current===ref?null:current)} onKeyDown={e=>handleKeyDown(e,r,c)} onPaste={e=>pasteBlock(e,r,c)} onChange={e=>update(r,c,e.target.value)} /></td>;})}</tr>)}</tbody></table></div>
    <div className="excel-exportbar"><div><button className="primary" onClick={exportXlsx}><Icon name="download" size={16}/>{t("excelExportXlsx")}</button><button onClick={exportCsv}>{t("excelExportCsv")}</button></div><span>{dirty?t("excelUnsaved"):localSavedAt?(lang==="fa"?"ذخیره خودکار روی این دستگاه":"Auto-saved on this device"):status||t("excelReady")} · {t("excelSelected").replace("{cell}",`${colName(selected[1]+1)}${selected[0]+1}`)}</span></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <p className="excel-note"><Icon name="info" size={16}/>{t("excelLimitations")}</p>
  </section>;
}
