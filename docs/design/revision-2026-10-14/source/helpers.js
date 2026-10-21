await figma.setCurrentPageAsync(await figma.getNodeByIdAsync(S.designPage));
for(const style of ['Regular','Medium','SemiBold','Bold'])await figma.loadFontAsync({family:'IBM Plex Sans',style});
const C=[],A=[],F={},vars={},geoVars={},comps={},styleMap={};
for(const [k,id]of Object.entries(S.variables))vars[k]=await figma.variables.getVariableByIdAsync(id);
for(const [k,id]of Object.entries(S.geometry))geoVars[k]=await figma.variables.getVariableByIdAsync(id);
for(const [k,id]of Object.entries(S.styles))styleMap[k]=await figma.getStyleByIdAsync(id);
for(const [name,vs]of Object.entries(S.variants)){comps[name]={};for(const [state,id]of Object.entries(vs))comps[name][state]=await figma.getNodeByIdAsync(id);}
function rem(n){C.push(n.id);return n;}
function fill(n,key,prop='fills'){const v=vars[key].resolveForConsumer(n).value;n[prop]=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:v.r,g:v.g,b:v.b}},'color',vars[key])];}
function geometry(n,pad=0,gap=8,r=0){for(const p of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])n.setBoundVariable(p,geoVars['space/'+pad]);n.setBoundVariable('itemSpacing',geoVars['space/'+gap]);if(r)for(const p of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'])n.setBoundVariable(p,geoVars['radius/'+r]);}
function al(parent,name,w,dir='VERTICAL',pad=0,gap=16,bg){const n=rem(figma.createAutoLayout(dir));n.name=name;parent.appendChild(n);n.resize(w,10);n.primaryAxisSizingMode='AUTO';n.counterAxisSizingMode='FIXED';n.layoutSizingVertical='HUG';n.counterAxisAlignItems='MIN';n.fills=[];n.clipsContent=false;geometry(n,pad,gap);if(bg)fill(n,bg);return n;}
async function tx(parent,str,w,sty='Body',colour='ink'){const t=rem(figma.createText());parent.appendChild(t);t.fontName=styleMap[sty].fontName;t.characters=str;t.name=str.slice(0,70);await t.setTextStyleIdAsync(styleMap[sty].id);t.textAutoResize='HEIGHT';t.resize(w,t.height);fill(t,colour);return t;}
function inst(parent,name,variant,props,w){const n=rem(comps[name][variant].createInstance());parent.appendChild(n);const p={};for(const [key,value]of Object.entries(props)){const prop=Object.keys(n.componentProperties).find(k=>k.split('#')[0]===key);if(prop)p[prop]=value;}n.setProperties(p);if(w)n.resize(w,n.height);if(name==='Field')n.layoutSizingVertical='HUG';return n;}
function route(n,to,overlay=false){if(to)A.push([n.id,to,overlay]);return n;}
function button(parent,label,to,kind='Secondary',w){const n=inst(parent,'Button','Kind='+kind,{Label:label},w||Math.max(112,Math.min(360,label.length*8+32)));n.name='Action · '+label;return route(n,to);}
function badge(parent,label,tone='Neutral',w){const n=inst(parent,'Status','Tone='+tone,{Label:label},w||Math.max(100,Math.min(270,label.length*6.5+24)));n.name='State · '+label;return n;}
function field(parent,label,value,w=320,multi=false){const n=inst(parent,'Field','Kind='+(multi?'Multiline':'Single'),{Label:label,Value:value},w);n.name='Field · '+label;return n;}
async function row(parent,name,w=1172,gap=16){return al(parent,name,w,'HORIZONTAL',0,gap);}
async function card(parent,name,w=1172,subtitle='',bg='surface'){const c=al(parent,name,w,'VERTICAL',16,12,bg);geometry(c,16,12,12);fill(c,'border','strokes');c.strokeWeight=1;await tx(c,name,w-32,'Title');if(subtitle)await tx(c,subtitle,w-32,'Caption','muted');return c;}
async function note(parent,title,body,w=1172,tone='Info'){const colours={Info:['blue','blueSoft'],Good:['green','greenSoft'],Warning:['amber','amberSoft'],Danger:['red','redSoft']};const [fg,bg]=colours[tone];const c=al(parent,title,w,'VERTICAL',12,6,bg);geometry(c,12,6,8);await tx(c,title,w-24,'Label',fg);if(body)await tx(c,body,w-24,'Caption',fg);return c;}
async function metricRow(parent,items){const r=al(parent,'Current operational measures',1172,'HORIZONTAL',0,12);const w=(1172-12*(items.length-1))/items.length;for(const [label,value,help]of items)inst(r,'Metric','Default',{Label:label,Value:value,Help:help},w);return r;}
async function table(parent,title,w,cols,widths,rows){const c=await card(parent,title,w);const h=al(c,'Column labels',w-32,'HORIZONTAL',8,0,'blueSoft');for(let i=0;i<cols.length;i++)await tx(h,cols[i],widths[i],'Caption');for(const [index,values]of rows.entries()){const r=al(c,'Record · '+values[0],w-32,'HORIZONTAL',8,0,index%2?'surface':'canvas');r.counterAxisAlignItems='CENTER';for(let i=0;i<values.length;i++)await tx(r,values[i],widths[i],i===0?'Label':'Body');}return c;}
async function tabs(parent,list,active,w=1172){const r=al(parent,'Record tabs',w,'HORIZONTAL',0,8);for(const [label,key]of list)button(r,label,key,key===active?'Primary':'Quiet',Math.max(96,label.length*8+32));return r;}

const roles={
ADMIN:{name:'Admin',person:'Prateek Yadav',base:100,nav:[['Overview','RAdmin'],['Beds & turnover','RBeds'],['Staff permissions','RStaff'],['Exceptions','RExceptions'],['Policy settings','RSettings']]},
ADMISSION:{name:'Admission',person:'Aditi Shah',base:100,nav:[['Find patient','WPatientSearch'],['Admission record','WIntake'],['Beds & arrival','WBedSuitability']]},
DOCTOR:{name:'Doctor',person:'Dr Kavita Menon',base:6100,nav:[['Clinical approval','WDoctorApproval']]},
NURSE:{name:'Nurse',person:'Priya Das',base:11000,nav:[['My patients','WNursingReadiness'],['Discharge checklist','WChecklist'],['Signed paper','WPaperVerification'],['Exit & turnover','WActualExit']]},
PHARMACY:{name:'Pharmacy',person:'Arjun Rao',base:6100,nav:[['Charges & returns','FPharmacy']]},
LAB:{name:'Department',person:'Nikhil Sen',base:18000,nav:[['Coordination checks','FDepartments']]},
INSURANCE:{name:'Insurance',person:'Sana Khan',base:11000,nav:[['Authorization','FInsurance'],['Collections','FCollections']]},
BILLING:{name:'Billing',person:'Neha Gupta',base:100,nav:[['Find patient','FLookup'],['As-of statement','FStatement'],['Charges','FCharges'],['Cashier','FCashier'],['Final review','FFinalPending'],['Documents','FPacket']]}
};
async function shell(role,key,title,subtitle,navKey,index,action){
const r=roles[role];if(figma.currentPage.children.some(n=>n.name===r.name+' · '+title))throw Error('Screen exists; targeted retry required');
const root=al(figma.currentPage,r.name+' · '+title,1440,'HORIZONTAL',0,0,'canvas');root.resize(1440,1024);root.primaryAxisSizingMode='FIXED';root.clipsContent=true;root.overflowDirection='VERTICAL';root.x=100+(index%3)*1560;root.y=r.base+100+Math.floor(index/3)*1280;F[key]=root.id;
const side=al(root,'Role navigation',220,'VERTICAL',16,12,'navBg');side.resize(220,1024);side.primaryAxisSizingMode='FIXED';await tx(side,'HIMS',188,'Heading','navInk');await tx(side,'LOTUS HOSPITAL',188,'Caption','navMuted');await tx(side,r.name.toUpperCase(),188,'Caption','navMuted');
for(const [label,to]of r.nav){const n=inst(side,'Navigation','State='+(to===navKey?'Active':'Default'),{Label:label},188);route(n,to);}
const spacer=al(side,'Space',188,'VERTICAL',0,0);spacer.layoutSizingVertical='FILL';await tx(side,r.person,188,'Label','navInk');button(side,'Switch demo role','RStart','Secondary',188);
const app=al(root,'Application',1220,'VERTICAL',0,0);const header=al(app,'Top bar',1220,'HORIZONTAL',24,16,'surface');header.resize(1220,76);header.primaryAxisSizingMode='FIXED';header.counterAxisAlignItems='CENTER';await tx(header,'LOTUS / Inpatient coordination',650,'Label');await tx(header,'FICTIONAL DEMO · 14 OCT 2026',490,'Caption','muted');
const body=al(app,'Work surface',1220,'VERTICAL',24,16);const hero=al(body,'Page heading',1172,'HORIZONTAL',0,16);const words=al(hero,'Purpose',action?810:1172,'VERTICAL',0,4);await tx(words,title,action?810:1172,'Heading');await tx(words,subtitle,action?810:1172,'Body','muted');if(action)button(hero,action[0],action[1],'Primary',346);return {root,body,role,key};
}
async function identity(parent,w=1172,limited=false){const p=al(parent,'Current patient identity',w,'HORIZONTAL',16,16,'blueSoft');geometry(p,16,16,12);const a=al(p,'Patient',w-350,'VERTICAL',0,4);await tx(a,'Meera Shah · MGH-00127',w-350,'Title');await tx(a,'IP-2026-00108 · General > G1 > G-12 · Admitted 07 Oct 10:00',w-350,'Caption','muted');const b=al(p,'Current episode',286,'VERTICAL',0,4);await tx(b,limited?'Purpose-limited access':'Dr Kavita Menon',286,'Label');await tx(b,'All times IST · fictional data',286,'Caption','muted');return p;}
function result(role){return {createdNodeIds:C,frames:F,actions:A,role};}
