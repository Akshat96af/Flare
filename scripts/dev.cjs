const {spawn}=require('node:child_process');
const path=require('node:path');
const vite=spawn(process.execPath,[path.join(__dirname,'../node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{stdio:'inherit'});
let child,stopped=false;
async function start(){for(let attempt=0;attempt<60&&!stopped;attempt++){try{const res=await fetch('http://127.0.0.1:5173');if(res.ok){const env={...process.env,FLARE_DEV_URL:'http://127.0.0.1:5173'};delete env.ELECTRON_RUN_AS_NODE;child=spawn(require('electron'),['.'],{stdio:'inherit',env});child.on('exit',()=>{stopped=true;vite.kill();});return;}}catch{}await new Promise(r=>setTimeout(r,500));}vite.kill();process.exitCode=1;}
process.on('SIGINT',()=>{stopped=true;child?.kill();vite.kill();});start();
