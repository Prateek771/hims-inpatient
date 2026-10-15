// New native Figma Design only. Never run against protected historical files.
const page=await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(page);
if(page.children.length) throw new Error('Expected empty new design. Read state before retry.');
page.name='Admin · Review';
await Promise.all(['Regular','Medium','SemiBold','Bold'].map(style=>figma.loadFontAsync({family:'Public Sans',style})));
const ids=[]; const track=n=>(ids.push(n.id),n);
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
// Adapted from the shipped createVariableCollection helper.
async function createVariableCollection(name,modeNames){const collection=figma.variables.createVariableCollection(name);collection.renameMode(collection.modes[0].modeId,modeNames[0]);return {collection,modeIds:{[modeNames[0]]:collection.modes[0].modeId}};}
const {collection,modeIds}=await createVariableCollection('HIMS MVP · Light',['Light']);
const colors={forest:'#203F35',ink:'#202D27',muted:'#56655D',linen:'#F2F1E9',white:'#FFFFFF',line:'#D9DED6',selected:'#E8F0E7',green:'#326046',amber:'#80520A',amberBg:'#FFF1D6',red:'#A1342C',redBg:'#FCECE8',soft:'#F8F9F5',whiteMuted:'#DCE7DC'};
const vars={};
for(const [key,value] of Object.entries(colors)){
 const p=figma.variables.createVariable('primitive/'+key,collection,'COLOR');p.scopes=[];p.setValueForMode(modeIds.Light,rgb(value));p.setVariableCodeSyntax('WEB','var(--hims-mvp-primitive-'+key+')');
 const v=figma.variables.createVariable('color/'+key,collection,'COLOR');v.scopes=['FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR'];v.setValueForMode(modeIds.Light,{type:'VARIABLE_ALIAS',id:p.id});v.setVariableCodeSyntax('WEB','var(--hims-mvp-'+key+')');vars[key]=v;
}
for(const [k,v] of Object.entries({gap:16,pad:24,radius:8})){const x=figma.variables.createVariable('space/'+k,collection,'FLOAT');x.scopes=k==='radius'?['CORNER_RADIUS']:['GAP'];x.setValueForMode(modeIds.Light,v);x.setVariableCodeSyntax('WEB','var(--hims-mvp-'+k+')');vars[k]=x;}
const paint=k=>figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(colors[k])},'color',vars[k]);
const styles={};
for(const [k,size,weight,line] of [['body',14,'Regular',21],['small',12,'Regular',18],['label',14,'SemiBold',21],['section',20,'SemiBold',28],['title',30,'SemiBold',38],['amount',24,'SemiBold',32]]){const s=figma.createTextStyle();s.name='MVP/'+k;s.fontName={family:'Public Sans',style:weight};s.fontSize=size;s.lineHeight={unit:'PIXELS',value:line};styles[k]=s;}
function text(p,value,style='body',color='ink',width){const t=track(figma.createText());t.name=value;t.fontName={family:'Public Sans',style:styles[style].fontName.style};t.characters=value;t.textStyleId=styles[style].id;t.fills=[paint(color)];if(width){t.textAutoResize='HEIGHT';t.resize(width,t.height);}p.appendChild(t);return t;}
function box(p,name,w,h,dir='VERTICAL',bg){const n=track(figma.createAutoLayout(dir));n.name=name;n.fills=bg?[paint(bg)]:[];n.resize(w,h);n.primaryAxisSizingMode='FIXED';n.counterAxisSizingMode='FIXED';n.clipsContent=false;if(p)p.appendChild(n);return n;}
function gap(n,v=16){n.itemSpacing=v;if(v===16)n.setBoundVariable('itemSpacing',vars.gap);}
function pad(n,v=24){n.paddingTop=n.paddingBottom=n.paddingLeft=n.paddingRight=v;if(v===24)for(const k of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])n.setBoundVariable(k,vars.pad);}
function line(p,w){return box(p,'Divider',w,1,'HORIZONTAL','line');}
function pair(p,label,value,w=352,c='ink',s='body'){const r=box(p,label,w,24,'HORIZONTAL');r.primaryAxisAlignItems='SPACE_BETWEEN';text(r,label,s,'muted');text(r,value,s,c);return r;}
const mains={};
// A compact local family; main components stay outside the review frame.
function family(name,states,width,height){const comps=[];for(const state of states){const c=track(figma.createComponent());c.name='State='+state;c.layoutMode='HORIZONTAL';c.resize(width,height);c.primaryAxisAlignItems='CENTER';c.counterAxisAlignItems='CENTER';c.paddingLeft=c.paddingRight=16;c.cornerRadius=8;c.setBoundVariable('cornerRadius',vars.radius);c.fills=[paint(state==='Default'?'forest':state==='Hover'?'green':state==='Selected'?'selected':state==='Error'?'redBg':'white')];if(['Focus','Disabled','Idle'].includes(state)){c.strokes=[paint(state==='Focus'?'green':'line')];c.strokeWeight=state==='Focus'?2:1;}const label=text(c,name==='Navigation'?'Patients & admissions':state==='Loading'?'Saving…':state==='Error'?'Retry save':'Review finances','label',state==='Default'||state==='Hover'?'white':state==='Disabled'?'muted':state==='Error'?'red':'forest');const prop=c.addComponentProperty('Label','TEXT',label.characters);label.componentPropertyReferences={characters:prop};c.description='Labelled '+name.toLowerCase()+'; static design state, no server action.';page.appendChild(c);comps.push(c);mains[name+'/'+state]={id:c.id,prop};}
 const set=track(figma.combineAsVariants(comps,page));set.name=name;set.x=100;set.y=name==='Button'?1400:1800;comps.forEach((c,i)=>{c.x=24+(i%4)*(width+24);c.y=24+Math.floor(i/4)*(height+24);});set.resize(4*(width+24)+24,2*(height+24)+24);return set;}
family('Button',['Default','Hover','Focus','Disabled','Loading','Error','Idle'],168,40);
family('Navigation',['Idle','Selected'],200,48);
function instance(p,f,state,label,width){const m=mains[f+'/'+state];const c=figma.getNodeById(m.id);const i=track(c.createInstance());p.appendChild(i);const key=Object.keys(i.componentProperties).find(k=>k.startsWith('Label'));if(key)i.setProperties({[key]:label});else {const t=i.findOne(n=>n.type==='TEXT');t.characters=label;}if(width)i.resize(width,i.height);return i;}
const root=box(page,'Admin dashboard · Inpatient operations',1600,1320,'VERTICAL','white');root.x=100;root.y=100;
const top=box(root,'Hospital header',1600,72,'HORIZONTAL','forest');top.paddingLeft=28;top.paddingRight=32;top.counterAxisAlignItems='CENTER';top.primaryAxisAlignItems='SPACE_BETWEEN';
const brand=box(top,'Hospital identity',420,32,'HORIZONTAL');gap(brand,24);text(brand,'HIMS','section','white');text(brand,'Lotus Hospital · Inpatient staff','body','whiteMuted');
text(top,'Fictional review data · 15 Oct 2026, 10:40','small','whiteMuted');text(top,'Prateek Yadav · Admin','label','white');
const body=box(root,'Application body',1600,1248,'HORIZONTAL');
const nav=box(body,'Six hospital sections',232,1248,'VERTICAL','linen');nav.paddingTop=28;nav.paddingLeft=16;nav.paddingRight=16;gap(nav,8);
text(nav,'Hospital workspace','label','muted');box(nav,'Space',200,12);
for(const label of ['Patients & admissions','Beds','Payments & insurance','Medicine bills & returns','Discharge','Staff & settings'])instance(nav,'Navigation',label==='Patients & admissions'?'Selected':'Idle',label,200);
box(nav,'Flexible space',200,490);line(nav,200);text(nav,'Morning shift · 07:00–15:00','small','muted');text(nav,'Staff access only','small','muted');
const main=box(body,'Admin workspace',1368,1248);pad(main,32);gap(main,20);
const heading=box(main,'Page heading',1304,64,'HORIZONTAL');heading.primaryAxisAlignItems='SPACE_BETWEEN';heading.counterAxisAlignItems='CENTER';const hc=box(heading,'Page title',790,64);gap(hc,4);text(hc,'Patients & admissions','title');text(hc,'Keep today’s admissions and departures moving.','body','muted');instance(heading,'Button','Default','View admissions',190);
const summary=box(main,'Shift summary',1304,48,'HORIZONTAL','soft');summary.paddingLeft=16;summary.counterAxisAlignItems='CENTER';gap(summary,32);text(summary,'12 current admissions','label');text(summary,'5 need action','label','amber');text(summary,'3 preparing to leave','body');text(summary,'7 beds available','body');text(summary,'Updated 10:40','small','muted');
const work=box(main,'Patient work and selected episode',1304,840,'HORIZONTAL');gap(work,24);
const queue=box(work,'Patient work queue',880,840);gap(queue,0);
const qt=box(queue,'Queue title',880,40,'HORIZONTAL');qt.primaryAxisAlignItems='SPACE_BETWEEN';text(qt,'Patient work queue','section');text(qt,'Sorted by next action','small','muted');
const filters=box(queue,'Queue filters',880,56,'HORIZONTAL');gap(filters,12);filters.counterAxisAlignItems='CENTER';instance(filters,'Button','Default','Needs action · 5',160);instance(filters,'Button','Idle','All patients · 12',160);const search=box(filters,'Patient search',380,40,'HORIZONTAL');search.strokes=[paint('line')];search.cornerRadius=8;search.paddingLeft=12;search.counterAxisAlignItems='CENTER';text(search,'Search name, UHID or IP…','body','muted');
const th=box(queue,'Column headers',880,40,'HORIZONTAL','soft');th.paddingLeft=16;gap(th,16);th.counterAxisAlignItems='CENTER';for(const [v,w] of [['Patient / episode',220],['Next action / blocker',270],['Owner',140],['Stage',150]])text(th,v,'small','muted',w);
const patients=[
 ['Meera Shah','MS4827361 · IP-2026-00142','Review final finances','Patient settled · insurer credit accepted','A. Desai','Billing','Final review','selected'],
 ['Arjun Patel','AP7392048 · IP-2026-00146','Record accepted returns','Pharmacy reconciliation pending','K. Rao','Pharmacy','Checks running','white'],
 ['Sana Khan','SK1948273 · IP-2026-00149','Confirm patient payment','₹8,500 patient amount due','R. Verma','Cashier','Settlement','white'],
 ['Dev Iyer','DI5839210 · IP-2026-00152','Confirm actual hospital exit','Authorized papers delivered · 10:25','N. Joseph','Assigned Nurse','Awaiting exit','white'],
 ['Leela Nair','LN8371946 · IP-2026-00158','Complete admission details','Urgent intake · deposit follow-up','P. Sen','Admission','Admission','white']
];
for(const [name,code,action,detail,owner,role,stage,bg] of patients){const row=box(queue,'Patient / '+name,880,104,'HORIZONTAL',bg);row.paddingLeft=row.paddingRight=16;row.paddingTop=18;gap(row,16);const a=box(row,'Identity',220,68);gap(a,6);text(a,name,'label');text(a,code,'small','muted',220);const b=box(row,'Next action',270,68);gap(b,6);text(b,action,'label',name==='Sana Khan'?'amber':'forest',270);text(b,detail,'small','muted',270);const c=box(row,'Action owner',140,68);gap(c,6);text(c,owner,'label');text(c,role,'small','muted',140);text(row,stage,'small',stage==='Settlement'?'amber':'muted',150);}
const qfooter=box(queue,'Queue footer',880,60,'HORIZONTAL');qfooter.paddingTop=16;qfooter.primaryAxisAlignItems='SPACE_BETWEEN';text(qfooter,'Showing 5 patients needing action','small','muted');text(qfooter,'View all 12 patients','label','green');
const detail=box(work,'Selected patient / Meera Shah',400,840,'VERTICAL','soft');pad(detail,24);gap(detail,8);
const dh=box(detail,'Patient detail heading',352,50);text(dh,'Meera Shah','section');text(dh,'Private 204-B · Nurse N. Joseph','small','muted');
const due=box(detail,'Next Admin action',352,72);gap(due,6);text(due,'Final finance review is next','label','forest');text(due,'Patient settled. ₹90,000 insurer receivable\nremains separate from cash.','body','muted',352);
line(detail,352);
const clinical=box(detail,'Recorded clinical authority',352,64);gap(clinical,4);text(clinical,'Doctor approval recorded','label','green');text(clinical,'Dr R. Mehta · signed paper, 09:10\nRecorded by N. Joseph · 09:18','small','muted',352);
const checks=box(detail,'Parallel applicable checks',352,90);gap(checks,4);text(checks,'Department checks · run in parallel','label');text(checks,'Pharmacy reconciled · K. Rao, 10:05','small','green');text(checks,'Nursing ready · N. Joseph, 10:12','small','green');text(checks,'Diagnostics N/A · Admin: no service or pending work','small','muted',352);
line(detail,352);
const money=box(detail,'Money summary',352,208);gap(money,2);pair(money,'Gross charges','₹1,20,000');pair(money,'Accepted medicine returns','−₹5,000');pair(money,'Net bill','₹1,15,000',352,'ink','label');pair(money,'Patient responsibility','₹25,000');pair(money,'Actual deposit / actual refund','₹30,000 / ₹5,000');pair(money,'Patient still due','₹0',352,'green');pair(money,'Insurer accepted / receivable','₹90,000',352,'forest','label');pair(money,'Insurer cash received','₹0');
const exit=box(detail,'Vacancy papers and exit facts',352,88);gap(exit,4);text(exit,'Bed vacant · held until exit & turnover','label','forest');text(exit,'Since 10:20 · discharge lounge · Nurse N. Joseph','small','muted',352);text(exit,'Clinical papers available · final papers pending','small','muted',352);text(exit,'Actual hospital exit not yet recorded','small','amber');
instance(detail,'Button','Default','Review final finances',352);
const foot=box(main,'Beds and shift operations',1304,116,'HORIZONTAL','linen');pad(foot,20);gap(foot,32);
const beds=box(foot,'Bed state summary',590,76);gap(beds,6);text(beds,'Beds · physical state stays visible','label');text(beds,'20 beds: 11 occupied · 7 available · 1 held · 1 cleaning','body','muted');text(beds,'Vacancy ends room use. Exit and turnover release the bed.','small','muted');
const staff=box(foot,'Doctor availability responsibility',610,76);gap(staff,6);text(staff,'Doctor availability · staff operations','label');text(staff,'Nurse P. Fernandes · shift owner | Backup: N. Joseph','body','muted');text(staff,'Dr R. Mehta available until 13:00 · updated 10:15 by P. Fernandes','small','muted');
text(main,'Fictional data for design review. Actions and permissions require future application implementation.','small','muted');
return {createdNodeIds:ids,mutatedNodeIds:[page.id],rootNodeId:root.id,pageId:page.id,componentMap:mains,collectionId:collection.id,variableIds:Object.values(vars).map(v=>v.id),textStyleIds:Object.values(styles).map(s=>s.id),dimensions:{width:root.width,height:root.height},counts:{nodes:ids.length,components:Object.keys(mains).length,patients:patients.length,sections:6},fileKey:figma.fileKey};
