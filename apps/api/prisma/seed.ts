import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';
const db=new PrismaClient();
async function main(){if(!['development','test'].includes(process.env.NODE_ENV??''))throw new Error('Development seed requires NODE_ENV=development or NODE_ENV=test');const passwordHash=await argon2.hash('DevelopmentOnly123!');await db.user.upsert({where:{email:'admin@example.test'},update:{},create:{email:'admin@example.test',passwordHash,role:Role.ADMIN}});}
main().finally(()=>db.$disconnect());
