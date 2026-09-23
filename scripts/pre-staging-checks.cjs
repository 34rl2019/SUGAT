// Reuse the isolated runner's environment; never load repository .env files.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
if(process.env.NODE_ENV!=='test'||!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55432\/sugat_pilot_validation_\d+$/.test(process.env.DATABASE_URL??''))throw new Error('Use the isolated validation wrapper');
const workspace=process.argv[2],root=path.join(os.tmpdir(),'sugat-pilot-validation'),tools=path.join(os.tmpdir(),'sugat-pilot-tools');
if(!workspace||!fs.existsSync(path.join(workspace,'AGENTS.md')))throw new Error('Source workspace is required');
const outputDir=path.join(workspace,'docs/validation'),pnpm=path.join(tools,'node_modules/pnpm/bin/pnpm.cjs');
const checks=[],records=[];
const p=(label,...args)=>checks.push({label,file:process.execPath,args:[pnpm,...args],cwd:root});
p('Prisma validate','--filter','@sugat/api','prisma','validate');
p('API build','--filter','@sugat/api','build');
p('API tests','--filter','@sugat/api','test');
p('Passenger Web tests','--filter','@sugat/passenger-web','test');
p('API typecheck','--filter','@sugat/api','exec','tsc','--noEmit');
p('Passenger Web typecheck','--filter','@sugat/passenger-web','exec','tsc','--noEmit');
p('Passenger Mobile typecheck','--filter','@sugat/passenger-mobile','typecheck');
p('UTC gate compilation','--filter','@sugat/api','exec','tsc','--noEmit','--target','es2022','--module','commonjs','--moduleResolution','node','--esModuleInterop','--experimentalDecorators','--emitDecoratorMetadata','--skipLibCheck','scripts/utc-release-gate.ts');
checks.push({label:'Whitespace check',file:path.join(tools,'mingit/cmd/git.exe'),args:['-c','safe.directory='+workspace.replace(/\\/g,'/'),'-c','core.autocrlf=false','diff','--check'],cwd:workspace});
const integration=process.argv[3]==='integration';
if(integration){checks.length=0;p('UTC database regression','--filter','@sugat/api','exec','tsx','scripts/utc-release-gate.ts');p('Database Redis E2E','--filter','@sugat/api','exec','tsx','scripts/e2e-final-release-gate.ts');}
for(const check of checks){
  const startedAt=new Date().toISOString();
  const result=spawnSync(check.file,check.args,{cwd:check.cwd,env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
  let output=(result.stdout??'')+(result.stderr??'');
  for(const key of ['DATABASE_URL','REDIS_URL','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','PGPASSWORD'])if(process.env[key])output=output.split(process.env[key]).join('[REDACTED]');
  const log='pre-staging-'+check.label.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.txt';fs.writeFileSync(path.join(outputDir,log),output);
  records.push({...check,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,error:result.error?.message??null,log});
  fs.writeFileSync(path.join(outputDir,integration?'pre-staging-integration-results.json':'pre-staging-source-results.json'),JSON.stringify(records,null,2));
  console.log(`${result.status===0?'PASS':'FAIL'} ${check.label} (exit ${result.status})`);
  if(result.status!==0)console.log(output.slice(-1400));
}
console.log(`${records.filter(row=>row.exitCode===0).length}/${records.length} checks passed`);
process.exitCode=records.every(row=>row.exitCode===0)?0:1;
