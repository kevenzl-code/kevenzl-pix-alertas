require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";

app.use(express.json());
app.use(express.static("public"));


// ======================================================
// SEGURANÇA DO PAINEL
// ======================================================

function protegerPainel(req, res, next) {

  const segredoServidor =
    String(process.env.PANEL_SECRET || "");

  const segredoRecebido =
    String(req.get("x-panel-secret") || "");


  if (!segredoServidor) {

    console.error(
      "PANEL_SECRET não configurado."
    );

    return res.status(500).json({
      error:
        "Segurança do painel não configurada."
    });

  }


  if (!segredoRecebido) {

    return res.status(401).json({
      error:
        "Acesso não autorizado."
    });

  }


  const recebido =
    Buffer.from(segredoRecebido);

  const esperado =
    Buffer.from(segredoServidor);


  const valido =
    recebido.length === esperado.length &&
    crypto.timingSafeEqual(
      recebido,
      esperado
    );


  if (!valido) {

    return res.status(401).json({
      error:
        "Acesso não autorizado."
    });

  }


  next();
}


// ======================================================
// VALIDAR WEBHOOK MERCADO PAGO
// ======================================================

function validarWebhookMercadoPago(req) {

  const secret =
    String(
      process.env.MP_WEBHOOK_SECRET || ""
    );


  if (!secret) {

    console.error(
      "MP_WEBHOOK_SECRET não configurado."
    );

    return false;

  }


  const xSignature =
    String(
      req.get("x-signature") || ""
    );

  const xRequestId =
    String(
      req.get("x-request-id") || ""
    );


  if (!xSignature) {

    console.warn(
      "Webhook sem x-signature."
    );

    return false;

  }


  const partes = {};


  for (
    const parte of xSignature.split(",")
  ) {

    const [
      chave,
      ...resto
    ] = parte.split("=");


    if (
      !chave ||
      !resto.length
    ) {

      continue;

    }


    partes[chave.trim()] =
      resto.join("=").trim();

  }


  const ts =
    partes.ts;

  const v1 =
    partes.v1;


  if (!ts || !v1) {

    console.warn(
      "x-signature inválido."
    );

    return false;

  }


  let dataId =
    req.query?.["data.id"];


  if (
    Array.isArray(dataId)
  ) {

    dataId =
      dataId[0];

  }


  dataId =
    dataId
      ? String(dataId)
      : "";


  let manifest =
    "";


  if (dataId) {

    manifest +=
      `id:${dataId};`;

  }


  if (xRequestId) {

    manifest +=
      `request-id:${xRequestId};`;

  }


  manifest +=
    `ts:${ts};`;


  const assinaturaCalculada =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(manifest)
      .digest("hex");


  if (
    !/^[a-fA-F0-9]{64}$/.test(v1)
  ) {

    return false;

  }


  const calculada =
    Buffer.from(
      assinaturaCalculada,
      "hex"
    );

  const recebida =
    Buffer.from(
      v1,
      "hex"
    );


  if (
    calculada.length !==
    recebida.length
  ) {

    return false;

  }


  return crypto.timingSafeEqual(
    calculada,
    recebida
  );

}


// ======================================================
// SUPABASE
// ======================================================

async function supabaseRequest(
  endpoint,
  options = {}
) {

  const url =
    String(
      process.env.SUPABASE_URL || ""
    ).replace(/\/+$/, "");

  const key =
    String(
      process.env.SUPABASE_SERVICE_KEY || ""
    );


  if (!url || !key) {

    throw new Error(
      "Supabase não configurado."
    );

  }


  return fetch(

    `${url}/rest/v1/${endpoint}`,

    {

      ...options,

      headers: {

        apikey:
          key,

        Authorization:
          `Bearer ${key}`,

        "Content-Type":
          "application/json",

        ...(options.headers || {})

      }

    }

  );

}


// ======================================================
// MEMÓRIA TEMPORÁRIA
// ======================================================

const donations =
  new Map();

const subscribers =
  new Set();

const audios =
  new Map();


// ======================================================
// CONFIGURAÇÃO PADRÃO
// ======================================================

let alertConfig = {

  volumeMeme:
    1,

  volumeVoz:
    1,

  memesAtivos:
    true,

  vozAtiva:
    true,

  duracao:
    12,

  flashAtivo:
    true,

  particulasAtivas:
    true,

  sons: {

    basic:
      "/sounds/basico.mp3",

    medium:
      "/sounds/medio.mp3",

    epic:
      "/sounds/epico.mp3",

    special:
      "/sounds/especial.mp3",

    legendary:
      "/sounds/lendario.mp3"

  }

};


// ======================================================
// SONS PERMITIDOS
// ======================================================

const allowedSounds =
  new Set([

    "/sounds/basico.mp3",

    "/sounds/medio.mp3",

    "/sounds/epico.mp3",

    "/sounds/especial.mp3",

    "/sounds/lendario.mp3"

  ]);


// ======================================================
// CONVERTER CONFIGURAÇÃO BANCO → SISTEMA
// ======================================================

function configDoBanco(row) {

  return {

    volumeMeme:
      Number(row.volume_meme),

    volumeVoz:
      Number(row.volume_voz),

    memesAtivos:
      row.memes_ativos,

    vozAtiva:
      row.voz_ativa,

    duracao:
      Number(row.duracao),

    flashAtivo:
      row.flash_ativo,

    particulasAtivas:
      row.particulas_ativas,

    sons: {

      basic:
        row.som_basic,

      medium:
        row.som_medium,

      epic:
        row.som_epic,

      special:
        row.som_special,

      legendary:
        row.som_legendary

    }

  };

}


// ======================================================
// CONVERTER CONFIGURAÇÃO SISTEMA → BANCO
// ======================================================

function configParaBanco(config) {

  return {

    id:
      1,

    volume_meme:
      config.volumeMeme,

    volume_voz:
      config.volumeVoz,

    memes_ativos:
      config.memesAtivos,

    voz_ativa:
      config.vozAtiva,

    duracao:
      config.duracao,

    flash_ativo:
      config.flashAtivo,

    particulas_ativas:
      config.particulasAtivas,

    som_basic:
      config.sons.basic,

    som_medium:
      config.sons.medium,

    som_epic:
      config.sons.epic,

    som_special:
      config.sons.special,

    som_legendary:
      config.sons.legendary,

    updated_at:
      new Date().toISOString()

  };

}


// ======================================================
// CARREGAR CONFIGURAÇÃO DO SUPABASE
// ======================================================

async function carregarConfigBanco() {

  try {

    const response =
      await supabaseRequest(
        "alert_config?id=eq.1&select=*"
      );


    if (!response.ok) {

      console.error(
        "Erro ao carregar configuração do Supabase:",
        response.status,
        await response.text()
      );

      return false;

    }


    const rows =
      await response.json();


    if (
      Array.isArray(rows) &&
      rows.length > 0
    ) {

      alertConfig =
        configDoBanco(
          rows[0]
        );


      console.log(
        "Configurações carregadas do Supabase."
      );


      return true;

    }


    console.warn(
      "Registro alert_config id=1 não encontrado."
    );


    return false;


  } catch (error) {

    console.error(
      "Erro ao carregar configuração:",
      error
    );


    return false;

  }

}


// ======================================================
// SALVAR CONFIGURAÇÃO NO SUPABASE
// ======================================================

async function salvarConfigBanco() {

  const response =
    await supabaseRequest(

      "alert_config?on_conflict=id",

      {

        method:
          "POST",

        headers: {

          Prefer:
            "resolution=merge-duplicates,return=representation"

        },

        body:
          JSON.stringify(
            configParaBanco(
              alertConfig
            )
          )

      }

    );


  if (!response.ok) {

    const erro =
      await response.text();


    console.error(
      "Erro ao salvar configuração no Supabase:",
      response.status,
      erro
    );


    throw new Error(
      "Não foi possível salvar configurações no banco."
    );

  }


  return response.json();

}


// ======================================================
// CONVERTER DOAÇÃO DO BANCO
// ======================================================

function donationDoBanco(row) {

  return {

    orderId:
      row.order_id,

    externalReference:
      row.external_reference,

    amount:
      Number(row.amount),

    name:
      row.name,

    email:
      row.email,

    message:
      row.message || "",

    tier:
      row.tier,

    status:
      row.status,

    alertSent:
      Boolean(row.alert_sent),

    createdAt:
      row.created_at,

    paidAt:
      row.paid_at

  };

}


// ======================================================
// SALVAR DOAÇÃO NO SUPABASE
// ======================================================

async function salvarDonationBanco(
  donation
) {

  const body = {

    order_id:
      String(donation.orderId),

    external_reference:
      donation.externalReference ||
      null,

    amount:
      Number(donation.amount),

    name:
      donation.name,

    email:
      donation.email || null,

    message:
      donation.message || "",

    tier:
      donation.tier,

    status:
      donation.status || "pending",

    alert_sent:
      Boolean(
        donation.alertSent
      ),

    created_at:
      donation.createdAt ||
      new Date().toISOString(),

    paid_at:
      donation.paidAt || null,

    updated_at:
      new Date().toISOString()

  };


  const response =
    await supabaseRequest(

      "donations?on_conflict=order_id",

      {

        method:
          "POST",

        headers: {

          Prefer:
            "resolution=merge-duplicates,return=representation"

        },

        body:
          JSON.stringify(body)

      }

    );


  if (!response.ok) {

    console.error(
      "Erro ao salvar doação:",
      response.status,
      await response.text()
    );


    return false;

  }


  return true;

}


// ======================================================
// BUSCAR DOAÇÃO NO SUPABASE
// ======================================================

async function buscarDonationBanco(
  orderId
) {

  try {

    const id =
      encodeURIComponent(
        String(orderId)
      );


    const response =
      await supabaseRequest(
        `donations?order_id=eq.${id}&select=*`
      );


    if (!response.ok) {

      console.error(
        "Erro ao buscar doação:",
        response.status,
        await response.text()
      );


      return null;

    }


    const rows =
      await response.json();


    if (
      !Array.isArray(rows) ||
      rows.length === 0
    ) {

      return null;

    }


    return donationDoBanco(
      rows[0]
    );


  } catch (error) {

    console.error(
      "Erro ao buscar doação no Supabase:",
      error
    );


    return null;

  }

}


// ======================================================
// ATUALIZAR DOAÇÃO NO SUPABASE
// ======================================================

async function atualizarDonationBanco(
  orderId,
  campos
) {

  try {

    const id =
      encodeURIComponent(
        String(orderId)
      );


    const response =
      await supabaseRequest(

        `donations?order_id=eq.${id}`,

        {

          method:
            "PATCH",

          headers: {

            Prefer:
              "return=minimal"

          },

          body:
            JSON.stringify({

              ...campos,

              updated_at:
                new Date()
                  .toISOString()

            })

        }

      );


    if (!response.ok) {

      console.error(
        "Erro ao atualizar doação:",
        response.status,
        await response.text()
      );


      return false;

    }


    return true;


  } catch (error) {

    console.error(
      "Erro ao atualizar doação:",
      error
    );


    return false;

  }

}


// ======================================================
// VOZ PADRÃO ELEVENLABS
// ======================================================

const DEFAULT_VOICE_ID =
  "JBFqnCBsd6RMkjVDRZzb";


// ======================================================
// DEFINIR CATEGORIA
// ======================================================

function tierFor(amount) {

  if (amount < 10) {
    return "basic";
  }

  if (amount < 25) {
    return "medium";
  }

  if (amount < 50) {
    return "epic";
  }

  if (amount < 100) {
    return "special";
  }

  return "legendary";

}


// ======================================================
// LIMPAR TEXTO
// ======================================================

function cleanText(text) {

  if (!text) {
    return "";
  }


  return String(text)

    .replace(
      /(https?:\/\/[^\s]+)/gi,
      ""
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim()

    .slice(
      0,
      250
    );

}


// ======================================================
// TRANSMITIR PARA OVERLAY
// ======================================================

function broadcast(payload) {

  const data =
    `data: ${JSON.stringify(payload)}\n\n`;


  for (
    const res of subscribers
  ) {

    try {

      res.write(data);

    } catch (error) {

      subscribers.delete(res);

    }

  }

}


// ======================================================
// ELEVENLABS
// ======================================================

async function generateTTS(
  name,
  amount,
  message
) {

  if (
    !process.env.ELEVENLABS_API_KEY
  ) {

    console.log(
      "ElevenLabs não configurada."
    );

    return null;

  }


  const safeName =
    cleanText(name) ||
    "Alguém";


  const safeMessage =
    cleanText(message);


  const value =
    Number(amount);


  const money =
    value.toLocaleString(
      "pt-BR",
      {

        style:
          "currency",

        currency:
          "BRL"

      }
    );


  let text =
    `${safeName} enviou ${money}.`;


  if (safeMessage) {

    text +=
      ` ${safeMessage}`;

  }


  const voiceId =
    process.env.ELEVENLABS_VOICE_ID ||
    DEFAULT_VOICE_ID;


  const response =
    await fetch(

      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId
      )}?output_format=mp3_44100_128`,

      {

        method:
          "POST",

        headers: {

          "xi-api-key":
            process.env.ELEVENLABS_API_KEY,

          "Content-Type":
            "application/json",

          Accept:
            "audio/mpeg"

        },

        body:
          JSON.stringify({

            text,

            model_id:
              "eleven_multilingual_v2",

            voice_settings: {

              stability:
                0.5,

              similarity_boost:
                0.75,

              style:
                0.15,

              use_speaker_boost:
                true

            }

          })

      }

    );


  if (!response.ok) {

    console.error(
      "ERRO ELEVENLABS:",
      response.status,
      await response.text()
    );


    return null;

  }


  const arrayBuffer =
    await response.arrayBuffer();


  const audioId =
    crypto.randomUUID();


  audios.set(

    audioId,

    {

      buffer:
        Buffer.from(
          arrayBuffer
        ),

      createdAt:
        Date.now()

    }

  );


  setTimeout(

    () => {

      audios.delete(
        audioId
      );

    },

    120000

  );


  return audioId;

}


// ======================================================
// HEALTH
// ======================================================

app.get(

  "/api/health",

  (req, res) => {

    res.json({

      ok:
        true,

      mercadopagoConfigured:
        Boolean(
          process.env.MP_ACCESS_TOKEN
        ),

      webhookProtegido:
        Boolean(
          process.env.MP_WEBHOOK_SECRET
        ),

      elevenlabsConfigured:
        Boolean(
          process.env.ELEVENLABS_API_KEY
        ),

      painelProtegido:
        Boolean(
          process.env.PANEL_SECRET
        ),

      supabaseConfigured:
        Boolean(
          process.env.SUPABASE_URL &&
          process.env.SUPABASE_SERVICE_KEY
        )

    });

  }

);


// ======================================================
// TESTAR SUPABASE
// ======================================================

app.get(

  "/api/db-test",

  protegerPainel,

  async (req, res) => {

    try {

      const response =
        await supabaseRequest(
          "alert_config?id=eq.1&select=*"
        );


      const texto =
        await response.text();


      if (!response.ok) {

        return res
          .status(500)
          .json({

            ok:
              false,

            supabase:
              "erro",

            status:
              response.status

          });

      }


      const data =
        JSON.parse(texto);


      res.json({

        ok:
          true,

        supabase:
          "conectado",

        registros:
          Array.isArray(data)
            ? data.length
            : 0

      });


    } catch (error) {

      res
        .status(500)
        .json({

          ok:
            false,

          supabase:
            "erro",

          error:
            error.message

        });

    }

  }

);


// ======================================================
// PEGAR CONFIGURAÇÕES
// ======================================================

app.get(

  "/api/config",

  protegerPainel,

  (req, res) => {

    res.json(
      alertConfig
    );

  }

);


// ======================================================
// SALVAR CONFIGURAÇÕES
// ======================================================

app.post(

  "/api/config",

  protegerPainel,

  async (req, res) => {

    try {

      const body =
        req.body || {};


      const volumeMeme =
        Number(
          body.volumeMeme
        );

      const volumeVoz =
        Number(
          body.volumeVoz
        );

      const duracao =
        Number(
          body.duracao
        );


      if (
        Number.isFinite(
          volumeMeme
        )
      ) {

        alertConfig.volumeMeme =
          Math.min(
            1,
            Math.max(
              0,
              volumeMeme
            )
          );

      }


      if (
        Number.isFinite(
          volumeVoz
        )
      ) {

        alertConfig.volumeVoz =
          Math.min(
            1,
            Math.max(
              0,
              volumeVoz
            )
          );

      }


      if (
        Number.isFinite(
          duracao
        )
      ) {

        alertConfig.duracao =
          Math.min(
            60,
            Math.max(
              3,
              duracao
            )
          );

      }


      if (
        typeof body.memesAtivos ===
        "boolean"
      ) {

        alertConfig.memesAtivos =
          body.memesAtivos;

      }


      if (
        typeof body.vozAtiva ===
        "boolean"
      ) {

        alertConfig.vozAtiva =
          body.vozAtiva;

      }


      if (
        typeof body.flashAtivo ===
        "boolean"
      ) {

        alertConfig.flashAtivo =
          body.flashAtivo;

      }


      if (
        typeof body.particulasAtivas ===
        "boolean"
      ) {

        alertConfig.particulasAtivas =
          body.particulasAtivas;

      }


      if (
        body.sons &&
        typeof body.sons ===
          "object"
      ) {

        const tiers = [
          "basic",
          "medium",
          "epic",
          "special",
          "legendary"
        ];


        for (
          const tier of tiers
        ) {

          const som =
            body.sons[tier];


          if (
            typeof som ===
              "string" &&
            allowedSounds.has(som)
          ) {

            alertConfig.sons[tier] =
              som;

          }

        }

      }


      // SALVA PERMANENTEMENTE
      await salvarConfigBanco();


      broadcast({

        type:
          "config",

        config:
          alertConfig

      });


      res.json({

        ok:
          true,

        saved:
          "supabase",

        config:
          alertConfig

      });


      console.log(
        "Configurações salvas no Supabase."
      );


    } catch (error) {

      console.error(
        "Erro ao salvar configurações:",
        error
      );


      res
        .status(500)
        .json({

          error:
            "Erro ao salvar configurações no banco."

        });

    }

  }

);


// ======================================================
// TESTAR ALERTA
// ======================================================

app.post(

  "/api/test-alert",

  protegerPainel,

  async (req, res) => {

    try {

      const requestedTier =
        String(
          req.body?.tier ||
          "basic"
        );


      const testValues = {

        basic:
          5,

        medium:
          15,

        epic:
          30,

        special:
          50,

        legendary:
          100

      };


      const tier =

        Object.prototype
          .hasOwnProperty
          .call(
            testValues,
            requestedTier
          )

          ? requestedTier
          : "basic";


      const amount =
        testValues[tier];


      let audioId =
        null;


      if (
        alertConfig.vozAtiva
      ) {

        try {

          audioId =
            await generateTTS(

              "KevenZL",

              amount,

              "Este é um teste do alerta Pix."

            );

        } catch (error) {

          console.error(
            "Erro ao gerar voz de teste:",
            error
          );

        }

      }


      const payload = {

        type:
          "donation",

        test:
          true,

        orderId:
          `teste_${crypto.randomUUID()}`,

        amount,

        name:
          "KevenZL",

        message:
          "Este é um teste do alerta Pix.",

        tier,

        audioUrl:
          audioId
            ? `/api/audio/${audioId}`
            : null,

        config:
          alertConfig

      };


      broadcast(
        payload
      );


      res.json({

        ok:
          true,

        alert:
          payload

      });


    } catch (error) {

      console.error(
        "Erro no teste:",
        error
      );


      res
        .status(500)
        .json({

          error:
            "Erro ao enviar alerta de teste."

        });

    }

  }

);


// ======================================================
// CRIAR PIX
// ======================================================

app.post(

  "/api/create-pix",

  async (req, res) => {

    try {

      const {
        amount,
        name,
        email,
        message = ""
      } = req.body;


      const value =
        Number(amount);


      if (
        !Number.isFinite(value) ||
        value < 1 ||
        value > 10000
      ) {

        return res
          .status(400)
          .json({

            error:
              "Valor inválido. Use entre R$ 1 e R$ 10.000."

          });

      }


      if (
        !name ||
        String(name)
          .trim()
          .length < 2
      ) {

        return res
          .status(400)
          .json({

            error:
              "Informe seu nome."

          });

      }


      if (
        !email ||
        !String(email)
          .includes("@")
      ) {

        return res
          .status(400)
          .json({

            error:
              "Informe um e-mail válido."

          });

      }


      if (
        !process.env.MP_ACCESS_TOKEN
      ) {

        return res
          .status(500)
          .json({

            error:
              "Mercado Pago não configurado."

          });

      }


      const externalReference =
        `kevenzl_${crypto.randomUUID()}`;


      const idempotencyKey =
        crypto.randomUUID();


      const donation = {

        externalReference,

        amount:
          value,

        name:
          String(name).trim(),

        email:
          String(email).trim(),

        message:
          cleanText(message),

        tier:
          tierFor(value),

        status:
          "pending",

        alertSent:
          false,

        createdAt:
          new Date().toISOString(),

        paidAt:
          null

      };


      const orderBody = {

        type:
          "online",

        total_amount:
          value.toFixed(2),

        external_reference:
          externalReference,

        processing_mode:
          "automatic",

        payer: {

          email:
            String(email).trim(),

          first_name:
            "APRO"

        },

        transactions: {

          payments: [

            {

              amount:
                value.toFixed(2),

              payment_method: {

                id:
                  "pix",

                type:
                  "bank_transfer"

              }

            }

          ]

        }

      };


      const response =
        await fetch(

          "https://api.mercadopago.com/v1/orders",

          {

            method:
              "POST",

            headers: {

              Authorization:
                `Bearer ${process.env.MP_ACCESS_TOKEN}`,

              "Content-Type":
                "application/json",

              Accept:
                "application/json",

              "X-Idempotency-Key":
                idempotencyKey

            },

            body:
              JSON.stringify(
                orderBody
              )

          }

        );


      const rawText =
        await response.text();


      let data;


      try {

        data =
          JSON.parse(
            rawText
          );

      } catch {

        data = {
          raw:
            rawText
        };

      }


      if (!response.ok) {

        console.error(
          "Mercado Pago:",
          response.status,
          data
        );


        return res
          .status(
            response.status ||
            502
          )
          .json({

            error:
              "Mercado Pago recusou a criação do Pix.",

            details:
              data

          });

      }


      const payment =
        data
          ?.transactions
          ?.payments
          ?.[0];


      donation.orderId =
        String(data.id);


      donation.status =
        data.status ||
        payment?.status ||
        "pending";


      // SALVA NA MEMÓRIA
      donations.set(
        donation.orderId,
        donation
      );


      // SALVA NO BANCO
      const salvoNoBanco =
        await salvarDonationBanco(
          donation
        );


      if (salvoNoBanco) {

        console.log(
          "Doação salva no Supabase:",
          donation.orderId
        );

      } else {

        console.warn(
          "Pix criado, mas houve erro ao salvar no Supabase."
        );

      }


      res.json({

        orderId:
          data.id,

        status:
          donation.status,

        ticketUrl:
          payment
            ?.payment_method
            ?.ticket_url ||
          payment
            ?.ticket_url ||
          null,

        qrCode:
          payment
            ?.payment_method
            ?.qr_code ||
          payment
            ?.qr_code ||
          null,

        qrCodeBase64:
          payment
            ?.payment_method
            ?.qr_code_base64 ||
          payment
            ?.qr_code_base64 ||
          null

      });


    } catch (error) {

      console.error(
        "Erro em /api/create-pix:",
        error
      );


      res
        .status(500)
        .json({

          error:
            "Erro interno ao criar o Pix."

        });

    }

  }

);


// ======================================================
// WEBHOOK MERCADO PAGO
// ======================================================

app.post(

  "/api/webhook/mercadopago",

  async (req, res) => {

    try {

      if (
        !validarWebhookMercadoPago(
          req
        )
      ) {

        console.warn(
          "Webhook rejeitado: assinatura inválida."
        );


        return res
          .sendStatus(401);

      }


      const orderId =
        req.query?.["data.id"] ||
        req.body
          ?.data
          ?.id;


      if (
        !orderId ||
        !process.env.MP_ACCESS_TOKEN
      ) {

        return res
          .sendStatus(200);

      }


      // CONFIRMA RECEBIMENTO AO MERCADO PAGO
      res.sendStatus(200);


      const orderResponse =
        await fetch(

          `https://api.mercadopago.com/v1/orders/${encodeURIComponent(
            String(orderId)
          )}`,

          {

            headers: {

              Authorization:
                `Bearer ${process.env.MP_ACCESS_TOKEN}`,

              Accept:
                "application/json"

            }

          }

        );


      if (
        !orderResponse.ok
      ) {

        console.error(
          "Erro consultando ordem:",
          orderResponse.status,
          await orderResponse.text()
        );


        return;

      }


      const order =
        await orderResponse.json();


      const payment =
        order
          ?.transactions
          ?.payments
          ?.[0];


      // PRIMEIRO TENTA MEMÓRIA
      let donation =
        donations.get(
          String(orderId)
        );


      // SE O RENDER REINICIOU,
      // BUSCA NO SUPABASE
      if (!donation) {

        console.log(
          "Buscando doação no Supabase:",
          orderId
        );


        donation =
          await buscarDonationBanco(
            orderId
          );


        if (donation) {

          donations.set(
            String(orderId),
            donation
          );

        }

      }


      if (!donation) {

        console.log(
          "Doação não encontrada:",
          orderId
        );


        return;

      }


      donation.status =
        order.status ||
        payment?.status ||
        "pending";


      const approved =

        order.status ===
          "processed" ||

        payment?.status ===
          "processed" ||

        payment?.status ===
          "approved" ||

        payment?.status_detail ===
          "accredited";


      // ATUALIZA STATUS NO BANCO
      await atualizarDonationBanco(

        orderId,

        {

          status:
            donation.status,

          ...(approved
            ? {

                paid_at:
                  donation.paidAt ||
                  new Date().toISOString()

              }
            : {})

        }

      );


      if (
        approved &&
        !donation.alertSent
      ) {

        donation.paidAt =
          donation.paidAt ||
          new Date().toISOString();


        // MARCA PRIMEIRO NO BANCO
        // PARA EVITAR ALERTA DUPLICADO
        const marcou =
          await atualizarDonationBanco(

            orderId,

            {

              status:
                donation.status,

              alert_sent:
                true,

              paid_at:
                donation.paidAt

            }

          );


        if (!marcou) {

          console.error(
            "Não foi possível marcar alerta no banco."
          );


          return;

        }


        donation.alertSent =
          true;


        let audioId =
          null;


        if (
          alertConfig.vozAtiva
        ) {

          try {

            audioId =
              await generateTTS(

                donation.name,

                donation.amount,

                donation.message

              );

          } catch (error) {

            console.error(
              "Erro ao gerar voz:",
              error
            );

          }

        }


        broadcast({

          type:
            "donation",

          orderId:
            String(orderId),

          amount:
            donation.amount,

          name:
            donation.name,

          message:
            donation.message,

          tier:
            donation.tier,

          audioUrl:
            audioId
              ? `/api/audio/${audioId}`
              : null,

          config:
            alertConfig

        });


        console.log(
          "Alerta enviado e registrado no Supabase."
        );

      }


    } catch (error) {

      console.error(
        "Webhook error:",
        error
      );


      if (
        !res.headersSent
      ) {

        res.sendStatus(500);

      }

    }

  }

);


// ======================================================
// SERVIR ÁUDIO
// ======================================================

app.get(

  "/api/audio/:audioId",

  (req, res) => {

    const audio =
      audios.get(
        String(
          req.params.audioId
        )
      );


    if (!audio) {

      return res
        .status(404)
        .send(
          "Áudio não encontrado."
        );

    }


    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    res.send(
      audio.buffer
    );

  }

);


// ======================================================
// STATUS DA DOAÇÃO
// ======================================================

app.get(

  "/api/status/:orderId",

  async (req, res) => {

    const orderId =
      String(
        req.params.orderId
      );


    let donation =
      donations.get(
        orderId
      );


    if (!donation) {

      donation =
        await buscarDonationBanco(
          orderId
        );

    }


    if (!donation) {

      return res
        .status(404)
        .json({

          error:
            "Doação não encontrada."

        });

    }


    res.json({

      orderId:
        donation.orderId,

      status:
        donation.status,

      amount:
        donation.amount,

      name:
        donation.name,

      message:
        donation.message,

      tier:
        donation.tier

    });

  }

);


// ======================================================
// STREAM DO OVERLAY
// ======================================================

app.get(

  "/api/overlay/stream",

  (req, res) => {

    res.setHeader(
      "Content-Type",
      "text/event-stream"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );


    res.flushHeaders?.();


    subscribers.add(
      res
    );


    res.write(

      `data: ${JSON.stringify({

        type:
          "connected",

        config:
          alertConfig

      })}\n\n`

    );


    req.on(

      "close",

      () => {

        subscribers.delete(
          res
        );

      }

    );

  }

);


// ======================================================
// OVERLAY
// ======================================================

app.get(

  "/overlay",

  (req, res) => {

    res.sendFile(

      path.join(
        __dirname,
        "public",
        "overlay.html"
      )

    );

  }

);


// ======================================================
// PAINEL
// ======================================================

app.get(

  "/painel",

  (req, res) => {

    res.sendFile(

      path.join(
        __dirname,
        "public",
        "painel.html"
      )

    );

  }

);


// ======================================================
// INICIAR SISTEMA
// ======================================================

async function iniciarServidor() {

  console.log(
    "Iniciando KevenZL Pix Alertas..."
  );


  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_KEY
  ) {

    await carregarConfigBanco();

  } else {

    console.warn(
      "Supabase não configurado."
    );

  }


  app.listen(

    PORT,

    HOST,

    () => {

      console.log(
        `KevenZL Pix Alertas na porta ${PORT}`
      );


      console.log(
        "Mercado Pago:",
        process.env.MP_ACCESS_TOKEN
          ? "OK"
          : "NÃO CONFIGURADO"
      );


      console.log(
        "Webhook:",
        process.env.MP_WEBHOOK_SECRET
          ? "PROTEGIDO"
          : "NÃO CONFIGURADO"
      );


      console.log(
        "ElevenLabs:",
        process.env.ELEVENLABS_API_KEY
          ? "OK"
          : "NÃO CONFIGURADO"
      );


      console.log(
        "Painel:",
        process.env.PANEL_SECRET
          ? "PROTEGIDO"
          : "NÃO CONFIGURADO"
      );


      console.log(
        "Supabase:",
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_KEY
          ? "OK"
          : "NÃO CONFIGURADO"
      );

    }

  );

}


iniciarServidor();
