import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';
const db=new PrismaClient();
async function main(){if(process.env.NODE_ENV==='production')throw new Error('Development seed is disabled in production');const passwordHash=await argon2.hash('DevelopmentOnly123!');await db.user.upsert({where:{email:'admin@example.test'},update:{},create:{email:'admin@example.test',passwordHash,role:Role.ADMIN}});}
main().finally(()=>db.$disconnect());
