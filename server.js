require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";

app.use(express.json());
app.use(express.static("public"));

const donations = new Map();
const subscribers = new Set();

function tierFor(amount) {
  if (amount < 10) return "basic";
  if (amount < 25) return "medium";
  if (amount < 50) return "epic";
  if (amount < 100) return "special";
  return "legendary";
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;

  for (const res of subscribers) {
    try {
      res.write(data);
    } catch {
      subscribers.delete(res);
    }
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mercadopagoConfigured: Boolean(process.env.MP_ACCESS_TOKEN)
  });
});

app.post("/api/create-pix", async (req, res) => {
  try {
    const { amount, name, email, message = "" } = req.body;
    const value = Number(amount);

    if (!Number.isFinite(value) || value < 1 || value > 10000) {
      return res.status(400).json({
        error: "Valor inválido. Use entre R$ 1 e R$ 10.000."
      });
    }

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({
        error: "Informe seu nome."
      });
    }

    if (!email || !String(email).includes("@")) {
      return res.status(400).json({
        error: "Informe um e-mail válido."
      });
    }

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "Mercado Pago ainda não está configurado no servidor."
      });
    }

    const externalReference = `kevenzl_${crypto.randomUUID()}`;
    const idempotencyKey = crypto.randomUUID();

    const donation = {
      externalReference,
      amount: value,
      name: String(name).trim(),
      email: String(email).trim(),
      message: String(message).trim(),
      tier: tierFor(value),
      status: "pending",
      createdAt: new Date().toISOString()
    };

    const orderBody = {
      type: "online",
      total_amount: value.toFixed(2),
      external_reference: externalReference,
      processing_mode: "automatic",

      payer: {
        email: String(email).trim()
      },

      transactions: {
        payments: [
          {
            amount: value.toFixed(2),
            payment_method: {
              id: "pix",
              type: "bank_transfer"
            }
          }
        ]
      }
    };

    const response = await fetch(
      "https://api.mercadopago.com/v1/orders",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(orderBody)
      }
    );

    const rawText = await response.text();

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = { raw: rawText };
    }

    if (!response.ok) {
      console.error(
        "Mercado Pago recusou a criação do Pix:",
        {
          status: response.status,
          statusText: response.statusText,
          response: data
        }
      );

      return res.status(response.status || 502).json({
        error: "Mercado Pago recusou a criação do Pix.",
        mercadopagoStatus: response.status,
        details: data
      });
    }

    const payment = data?.transactions?.payments?.[0];

    donation.orderId = data.id;
    donation.status =
      data.status ||
      payment?.status ||
      "pending";

    donations.set(String(data.id), donation);

    res.json({
      orderId: data.id,
      status: donation.status,

      ticketUrl:
        payment?.payment_method?.ticket_url ||
        payment?.ticket_url ||
        null,

      qrCode:
        payment?.payment_method?.qr_code ||
        payment?.qr_code ||
        null,

      qrCodeBase64:
        payment?.payment_method?.qr_code_base64 ||
        payment?.qr_code_base64 ||
        null
    });

  } catch (error) {
    console.error(
      "Erro interno em /api/create-pix:",
      error
    );

    res.status(500).json({
      error: "Erro interno ao criar o Pix."
    });
  }
});

app.post(
  "/api/webhook/mercadopago",
  async (req, res) => {

    res.sendStatus(200);

    try {

      const orderId =
        req.body?.data?.id;

      if (
        !orderId ||
        !process.env.MP_ACCESS_TOKEN
      ) {
        return;
      }

      const response =
        await fetch(
          `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,
          {
            headers: {
              Authorization:
                `Bearer ${process.env.MP_ACCESS_TOKEN}`,
              Accept: "application/json"
            }
          }
        );

      if (!response.ok) {
        console.error(
          "Erro ao consultar ordem no webhook:",
          response.status,
          await response.text()
        );
        return;
      }

      const order =
        await response.json();

      const payment =
        order?.transactions?.payments?.[0];

      const donation =
        donations.get(String(orderId));

      if (!donation) return;

      donation.status =
        order.status ||
        payment?.status ||
        "pending";

      const approved =
        order.status === "processed" ||
        payment?.status === "processed" ||
        payment?.status_detail === "accredited";

      if (
        approved &&
        !donation.alertSent
      ) {

        donation.alertSent = true;

        broadcast({
          type: "donation",
          orderId: String(orderId),
          amount: donation.amount,
          name: donation.name,
          message: donation.message,
          tier: donation.tier
        });
      }

    } catch (error) {
      console.error(
        "Webhook error:",
        error
      );
    }
  }
);

app.get(
  "/api/status/:orderId",
  (req, res) => {

    const donation =
      donations.get(
        String(req.params.orderId)
      );

    if (!donation) {
      return res.status(404).json({
        error: "Doação não encontrada."
      });
    }

    res.json({
      orderId: donation.orderId,
      status: donation.status,
      amount: donation.amount,
      name: donation.name,
      message: donation.message,
      tier: donation.tier
    });
  }
);

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

    subscribers.add(res);

    res.write(
      `data: ${JSON.stringify({
        type: "connected"
      })}\n\n`
    );

    req.on(
      "close",
      () => {
        subscribers.delete(res);
      }
    );
  }
);

app.get("/overlay", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "overlay.html"
    )
  );
});

app.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `KevenZL Pix Alertas na porta ${PORT}`
    );
  }
);
