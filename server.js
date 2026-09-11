require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const donations = new Map();
const subscribers = new Set();

function tierFor(amount) {
  if (amount < 10) return {key:"basic", label:"Básico", effect:"pulse"};
  if (amount < 25) return {key:"medium", label:"Médio", effect:"shake"};
  if (amount < 50) return {key:"epic", label:"Épico", effect:"flash"};
  if (amount < 100) return {key:"special", label:"Especial", effect:"burst"};
  return {key:"legendary", label:"Lendário", effect:"legendary"};
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of subscribers) { try { res.write(data); } catch {} }
}

app.get("/api/health",(req,res)=>res.json({ok:true, mercadopagoConfigured:Boolean(MP_ACCESS_TOKEN)}));

app.post("/api/create-pix",async(req,res)=>{
  try {
    if (!MP_ACCESS_TOKEN) return res.status(500).json({error:"MP_ACCESS_TOKEN não configurado."});
    const amount=Number(req.body.amount);
    const name=String(req.body.name||"").trim().slice(0,60);
    const message=String(req.body.message||"").trim().slice(0,300);
    const email=String(req.body.email||"").trim().toLowerCase().slice(0,120);
    if(!Number.isFinite(amount)||amount<1||amount>10000) return res.status(400).json({error:"Valor inválido."});
    if(!name) return res.status(400).json({error:"Informe seu nome."});
    if(!email.includes("@")) return res.status(400).json({error:"Informe um e-mail válido."});

    const reference=`kevenzl_${crypto.randomUUID()}`;
    const body={
      type:"online",
      total_amount:amount.toFixed(2),
      external_reference:reference,
      processing_mode:"automatic",
      transactions:{payments:[{
        amount:amount.toFixed(2),
        payment_method:{id:"pix",type:"bank_transfer"}
      }]},
      payer:{email}
    };

    const mp=await fetch("https://api.mercadopago.com/v1/orders",{
      method:"POST",
      headers:{
        accept:"application/json",
        "content-type":"application/json",
        Authorization:`Bearer ${MP_ACCESS_TOKEN}`,
        "X-Idempotency-Key":crypto.randomUUID()
      },
      body:JSON.stringify(body)
    });
    const data=await mp.json();
    if(!mp.ok) return res.status(mp.status).json({error:"Mercado Pago recusou a criação do Pix.",details:data});

    const payment=data?.transactions?.payments?.[0];
    const pix=payment?.payment_method;
    donations.set(data.id,{orderId:data.id,reference,amount,name,message,email,status:data.status,createdAt:new Date().toISOString()});

    res.json({ok:true,orderId:data.id,status:data.status,ticketUrl:pix?.ticket_url||null,qrCode:pix?.qr_code||null,qrCodeBase64:pix?.qr_code_base64||null});
  } catch(e) { console.error(e); res.status(500).json({error:"Erro interno ao criar o Pix."}); }
});

app.post("/api/webhook/mercadopago",async(req,res)=>{
  res.sendStatus(200);
  try {
    if(!MP_ACCESS_TOKEN) return;
    const orderId=req.body?.data?.id||req.query["data.id"];
    if(!orderId) return;
    const mp=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,{
      headers:{accept:"application/json",Authorization:`Bearer ${MP_ACCESS_TOKEN}`}
    });
    if(!mp.ok) return;
    const order=await mp.json();
    const saved=donations.get(orderId);
    if(!saved) return;
    const payment=order?.transactions?.payments?.[0];
    saved.status=order?.status;
    saved.paymentStatus=payment?.status;
    saved.paymentStatusDetail=payment?.status_detail;

    const approved=order?.status==="processed"||payment?.status==="processed"||payment?.status_detail==="accredited";
    if(approved&&!saved.alertSent){
      saved.alertSent=true;
      const tier=tierFor(saved.amount);
      broadcast({type:"donation",orderId,amount:saved.amount,name:saved.name,message:saved.message,tier:tier.key,tierLabel:tier.label,effect:tier.effect});
    }
  } catch(e) { console.error("Webhook error:",e); }
});

app.get("/api/status/:orderId",(req,res)=>{
  const d=donations.get(req.params.orderId);
  if(!d) return res.status(404).json({error:"Doação não encontrada."});
  res.json({status:d.status,paymentStatus:d.paymentStatus,paymentStatusDetail:d.paymentStatusDetail,approved:Boolean(d.alertSent)});
});

app.get("/api/overlay/stream",(req,res)=>{
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache");
  res.setHeader("Connection","keep-alive");
  res.flushHeaders();
  subscribers.add(res);
  res.write(`data: ${JSON.stringify({type:"connected"})}\n\n`);
  req.on("close",()=>subscribers.delete(res));
});

app.get("/overlay",(req,res)=>res.sendFile(path.join(__dirname,"public","overlay.html")));
app.listen(PORT,"0.0.0.0",()=>console.log(`KevenZL Pix Alertas na porta ${PORT}`));
