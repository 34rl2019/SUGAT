import test from 'node:test';
import assert from 'node:assert/strict';
import { startSelection } from './start-selection.js';
const options = () => ({ vehicles:[{id:'v'}], stops:['a','b','c'].map(id=>({id})), routes:[{id:'r',stops:['a','b','c'].map((stopId,i)=>({stopId,sequence:i+1,boardingAllowed:true,dropoffAllowed:true}))}] });
test('sends all four selected IDs',()=>assert.deepEqual(startSelection(options(),'r','v','a','c'),{routeId:'r',vehicleId:'v',startStopId:'a',destinationStopId:'c'}));
for (const ids of [['','v','a','c'],['r','','a','c'],['r','v','','c'],['r','v','a',''],['r','v','a','a'],['r','v','c','a'],['r','v','foreign','c'],['foreign','v','a','c'],['r','foreign','a','c']]) {
 test(`blocks invalid selection ${ids.join('/')}`,()=>assert.equal(startSelection(options(),...ids),null));
}
test('rejects inactive stops and disabled boarding/dropoff',()=>{
 for(const reason of ['inactive','boarding','dropoff']){const o=options();if(reason==='inactive')o.stops=o.stops.filter(s=>s.id!=='a');if(reason==='boarding')o.routes[0].stops[0].boardingAllowed=false;if(reason==='dropoff')o.routes[0].stops[2].dropoffAllowed=false;assert.equal(startSelection(o,'r','v','a','c'),null);}
});
