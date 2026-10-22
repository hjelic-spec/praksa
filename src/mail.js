// Slanje e-pošte (reset lozinke, obavijest administratoru o novoj registraciji).
// Radi samo kad su postavljeni PRAKSA_SMTP_URL, PRAKSA_MAIL_FROM i PRAKSA_PUBLIC_URL (poveznice u
// porukama vode na javnu adresu). PRAKSA_SMTP_URL=json ne šalje ništa, nego poruke zadržava u
// memoriji (outbox) – za testove i probu bez poslužitelja e-pošte.
import nodemailer from 'nodemailer';
import { config } from './config.js';

export const outbox = [];
let transport;

export const configured = () => Boolean(config.smtpUrl && config.mailFrom && config.publicUrl);

function getTransport() {
  transport ??= config.smtpUrl === 'json'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport(config.smtpUrl);
  return transport;
}

export async function send({ to, subject, text }) {
  if (!configured()) throw Object.assign(new Error('Slanje e-pošte nije postavljeno.'), { status: 400 });
  const info = await getTransport().sendMail({ from: config.mailFrom, to, subject, text });
  if (config.smtpUrl === 'json') outbox.push(JSON.parse(info.message));
  return info;
}
