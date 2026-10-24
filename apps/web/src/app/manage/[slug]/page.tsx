import {PublicOperations} from '@/features/public-operations';
export default async function Page({params}:{params:Promise<{slug:string}>}) {const {slug}=await params;return <PublicOperations slug={slug} mode="manage"/>;}
