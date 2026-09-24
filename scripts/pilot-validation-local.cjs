// Windows-only portable test infrastructure. All state is under TEMP; no system services.
// Provision the reviewed PostgreSQL/PostGIS and Redis archives before using this runner.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const root=path.join(os.tmpdir(),'sugat-post-validation'),source=path.join(os.tmpdir(),'sugat-pilot-validation');
const tools=path.join(os.tmpdir(),'sugat-pilot-tools'),pnpm=path.join(tools,'node_modules/pnpm/bin/pnpm.cjs');
const pg=path.join(root,'postgres/pgsql/bin'),redis=path.join(root,'redis/Redis-7.2.8-Windows-x64-msys2');
const configFile=path.join(root,'isolated-config.json');
function run(file,args,options={}){const out=spawnSync(file,args,{cwd:source,env:environment(),stdio:'inherit',windowsHide:true,...options});if(out.error)throw out.error;if(out.status!==0)throw new Error(`${path.basename(file)} failed with ${out.status}`);return out;}
let config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):null;
function environment(){return {...process.env,PATH:path.dirname(process.execPath)+';'+process.env.PATH,...(config?{
  NODE_ENV:'test',DATABASE_URL:`postgresql://postgres:${config.password}@127.0.0.1:55432/${config.database}`,
  REDIS_URL:`redis://:${config.password}@127.0.0.1:56379`,REDISCLI_AUTH:config.password,PGPASSWORD:config.password,
  JWT_ACCESS_SECRET:config.accessSecret,JWT_REFRESH_SECRET:config.refreshSecret,CORS_ORIGINS:'http://127.0.0.1:4177',HOST:'127.0.0.1',PORT:'53000',
  DRIVER_DOCUMENT_STORAGE_DIR:path.join(root,'private-documents'),SUGAT_E2E_ROOT:source,SUGAT_E2E_API_PID:String(config.apiPid??''),
  SUGAT_E2E_API_LOG:path.join(root,'api.log'),SUGAT_E2E_RESULT_FILE:path.join(root,'e2e-result.json'),
  SUGAT_E2E_REDIS_CONTROL:__filename,SUGAT_VALIDATION_API:'http://127.0.0.1:53000',SUGAT_VALIDATION_SOCKET:'http://127.0.0.1:53001',
  NODE_PATH:path.join(tools,'node_modules')+';'+path.join(source,'apps/api/node_modules'),
  SUGAT_BROWSER_PATH:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
}: {})};}
function save(){fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});}
function background(executable,args,log){const out=fs.openSync(path.join(root,log),'a');const child=spawn(executable,args,{cwd:source,env:environment(),stdio:['ignore',out,out],windowsHide:true,detached:true});child.unref();fs.closeSync(out);return child.pid;}
async function waitFor(check,label){for(let i=0;i<60;i++){if(await check())return;await new Promise(done=>setTimeout(done,500))}throw new Error(`${label} did not become ready`);}
async function redisAction(action){
  if(!config)throw new Error('Initialize isolated validation first');
  const Redis=require(path.join(source,'apps/api/node_modules/ioredis'));
  if(action==='stop'){const client=new Redis(environment().REDIS_URL,{retryStrategy:()=>null,maxRetriesPerRequest:1});client.on('error',()=>{});try{await client.shutdown('NOSAVE')}catch(error){if(error.message!=='Connection is closed.')throw error}finally{client.disconnect()}return;}
  const file=path.join(root,'redis-validation.conf');fs.writeFileSync(file,`bind 127.0.0.1\nport 56379\nprotected-mode yes\nsave ""\nappendonly no\nrequirepass ${config.password}\n`);
  const posixFile=file.replace(/^([A-Za-z]):/,(_match,drive)=>'/cygdrive/'+drive.toLowerCase()).replace(/\\/g,'/');
  config.redisPid=background(path.join(redis,'redis-server.exe'),[posixFile],'redis.log');save();
  await waitFor(async()=>{const client=new Redis(environment().REDIS_URL,{lazyConnect:true,retryStrategy:()=>null,connectTimeout:500});client.on('error',()=>{});try{await client.connect();return await client.ping()==='PONG'}catch{return false}finally{client.disconnect()}},'Redis');
}
async function main(){
  const action=process.argv[2];
  if(action==='init'){
    if(config)throw new Error('An isolated configuration already exists; it will not be overwritten');
    const suffix=Date.now();config={database:`sugat_pilot_validation_${suffix}`,data:path.join(root,`pgdata-${suffix}`),password:crypto.randomBytes(24).toString('hex'),accessSecret:crypto.randomBytes(32).toString('hex'),refreshSecret:crypto.randomBytes(32).toString('hex')};
    const passwordFile=path.join(root,'init-password.txt');fs.writeFileSync(passwordFile,config.password,{mode:0o600});
    run(path.join(pg,'initdb.exe'),['-D',config.data,'-U','postgres','--auth=scram-sha-256','--pwfile',passwordFile,'--encoding=UTF8','--locale=C']);save();
    run(path.join(pg,'pg_ctl.exe'),['-D',config.data,'-l',path.join(root,'postgres.log'),'-o','-h 127.0.0.1 -p 55432','-w','start']);
    run(path.join(pg,'psql.exe'),['-h','127.0.0.1','-p','55432','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:`CREATE DATABASE "${config.database}"; ALTER DATABASE "${config.database}" SET timezone='UTC';`,stdio:['pipe','inherit','inherit']});
    await redisAction('start');console.log(`PASS isolated stack initialized: ${config.database}, PostgreSQL :55432, Redis :56379`);return;
  }
  if(!config)throw new Error('Initialize isolated validation first');
  if(action==='postgres-start'){run(path.join(pg,'pg_ctl.exe'),['-D',config.data,'-l',path.join(root,'postgres.log'),'-o','-h 127.0.0.1 -p 55432','-w','start']);return;}
  if(action==='utc'||action==='non-utc'){run(path.join(pg,'psql.exe'),['-h','127.0.0.1','-p','55432','-U','postgres','-d',config.database,'-v','ON_ERROR_STOP=1'],{input:`ALTER DATABASE "${config.database}" SET timezone='${action==='utc'?'UTC':'America/Los_Angeles'}';`,stdio:['pipe','inherit','inherit']});return;}
  if(action==='api-stop'){for(const pid of [config.apiPid,config.api2Pid])if(pid){try{process.kill(pid)}catch(error){if(error.code!=='ESRCH')throw error}}config.apiPid=null;config.api2Pid=null;save();return;}
  if(action==='start'||action==='stop')return redisAction(action); // Existing E2E outage hook.
  if(action==='api'){
    config.apiPid=background(process.execPath,[path.join(source,'apps/api/dist/src/main.js')],'api.log');save();
    const original=process.env.PORT;process.env.PORT='53001';
    // Explicit child override; API 2 shares only the isolated DB and Redis.
    const out=fs.openSync(path.join(root,'api2.log'),'a');const child=spawn(process.execPath,[path.join(source,'apps/api/dist/src/main.js')],{cwd:source,env:{...environment(),PORT:'53001'},stdio:['ignore',out,out],windowsHide:true,detached:true});child.unref();fs.closeSync(out);config.api2Pid=child.pid;save();if(original===undefined)delete process.env.PORT;else process.env.PORT=original;
    await waitFor(async()=>{try{return(await fetch('http://127.0.0.1:53000/health')).ok&&(await fetch('http://127.0.0.1:53001/health')).ok}catch{return false}},'API instances');console.log('PASS two isolated API instances :53000/:53001');return;
  }
  if(action==='pnpm'){run(process.execPath,[pnpm,...process.argv.slice(3)]);return;}
  if(action==='node'){run(process.execPath,process.argv.slice(3));return;}
  if(action==='shutdown'){
    for(const pid of [config.apiPid,config.api2Pid])if(pid){try{process.kill(pid)}catch(error){if(error.code!=='ESRCH')throw error}}
    await redisAction('stop');run(path.join(pg,'pg_ctl.exe'),['-D',config.data,'-m','fast','-w','stop']);console.log('PASS isolated processes stopped; fixture data retained');return;
  }
  throw new Error('Choose init, api, pnpm, node, shutdown');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
