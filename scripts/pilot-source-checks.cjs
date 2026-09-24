// Run through pilot-validation-local.cjs so all database settings are isolated.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
if(process.env.NODE_ENV!=='test'||!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55432\/sugat_pilot_validation_\d+$/.test(process.env.DATABASE_URL??''))throw new Error('Run through the isolated validation wrapper');
const workspace=process.argv[2];if(!workspace||!fs.existsSync(path.join(workspace,'AGENTS.md')))throw new Error('Source workspace argument is required');
const root=path.join(os.tmpdir(),'sugat-pilot-validation'),tools=path.join(os.tmpdir(),'sugat-pilot-tools');
const pnpm=path.join(tools,'node_modules/pnpm/bin/pnpm.cjs'),directory=path.join(workspace,'docs/validation');
const env={...process.env,EXPO_PUBLIC_API_URL:'https://api.example.test/api/v1',EXPO_PUBLIC_APP_ENV:'production',EXPO_NO_TELEMETRY:'1',CI:'true',VITE_API_URL:'http://127.0.0.1:53000/api/v1',VITE_SOCKET_URL:'http://127.0.0.1:53001'};
const checks=[];
const p=(label,...args)=>checks.push({label,file:process.execPath,args:[pnpm,...args],cwd:root});
p('Prisma generate','--filter','@sugat/api','prisma','generate');
p('Prisma validate','--filter','@sugat/api','prisma','validate');
p('API unit tests','--filter','@sugat/api','test');
p('API build','--filter','@sugat/api','build');
p('Passenger Web tests','--filter','@sugat/passenger-web','test');
p('Admin Web tests','--filter','@sugat/admin-web','test');
checks.push({label:'Driver queue and lifecycle tests',file:process.execPath,args:['--test','apps/driver-mobile/src/location/queue-policy.test.mjs','apps/driver-mobile/src/location/tracking-lifecycle.test.mjs'],cwd:root});
for(const app of ['passenger-web','admin-web'])p(app+' typecheck','--filter','@sugat/'+app,'exec','tsc','--noEmit');
for(const app of ['passenger-mobile','driver-mobile','admin-mobile'])p(app+' typecheck','--filter','@sugat/'+app,'typecheck');
for(const app of ['passenger-web','admin-web'])p(app+' build','--filter','@sugat/'+app,'build');
for(const app of ['passenger-mobile','driver-mobile','admin-mobile'])p(app+' Android export','--filter','@sugat/'+app,'exec','expo','export','--platform','android','--max-workers','2');
p('Integration runner compilation','--filter','@sugat/api','exec','tsc','--noEmit','--target','es2022','--module','commonjs','--moduleResolution','node','--esModuleInterop','--skipLibCheck','scripts/e2e-final-release-gate.ts','scripts/pilot-migration-gate.ts','scripts/pilot-stack-browser.ts');
checks.push({label:'Whitespace check',file:path.join(tools,'mingit/cmd/git.exe'),args:['-c','safe.directory='+workspace.replace(/\\/g,'/'),'-c','core.autocrlf=false','diff','--check'],cwd:workspace});
fs.mkdirSync(directory,{recursive:true});const records=[];
for(const check of checks){
  const startedAt=new Date().toISOString();
  const result=spawnSync(check.file,check.args,{cwd:check.cwd,env:{...env,...(check.label.endsWith(' build')||check.label.endsWith(' export')?{NODE_ENV:'production'}:{})},encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
  let output=(result.stdout??'')+(result.stderr??'');
  for(const key of ['DATABASE_URL','REDIS_URL','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','PGPASSWORD'])if(env[key])output=output.split(env[key]).join('[REDACTED]');
  const log=check.label.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.log';fs.writeFileSync(path.join(directory,log),output);
  records.push({...check,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,error:result.error?.message??null,log});
  fs.writeFileSync(path.join(directory,'pilot-source-results.json'),JSON.stringify(records,null,2));
  console.log(`${result.status===0?'PASS':'FAIL'} ${check.label} (exit ${result.status})`);
  if(result.status!==0)console.log(output.slice(-1500));
}
console.log(`${records.filter(row=>row.exitCode===0).length}/${records.length} checks passed`);
process.exitCode=records.every(row=>row.exitCode===0)?0:1;
