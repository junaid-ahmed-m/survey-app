import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface CouponMailPayload {
  to: string;
  couponCode: string;
  couponName: string;
  couponValue?: string | null;
  expiresAt?: Date | null;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const mail = this.config.get('mail') as {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
    };

    if (!mail.host) {
      this.logger.warn('SMTP is not configured - reward e-mails will be written to the log instead.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      ...(mail.user ? { auth: { user: mail.user, pass: mail.password } } : {}),
    });
  }

  async sendCoupon(payload: CouponMailPayload): Promise<boolean> {
    const from = this.config.get<string>('mail.from');
    const subject = `Your reward is here: ${payload.couponName}`;
    const html = this.buildHtml(payload);

    if (!this.transporter) {
      this.logger.log(
        `[MAIL:DRY-RUN] to=${payload.to} subject="${subject}" coupon=${payload.couponCode}`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from,
        to: payload.to,
        subject,
        html,
        text:
          `Thanks for completing the survey!\n\n` +
          `Your ${payload.couponName} code: ${payload.couponCode}\n` +
          (payload.expiresAt ? `Valid until: ${payload.expiresAt.toDateString()}\n` : ''),
      });
      return true;
    } catch (error) {
      // Never fail the redemption because of a mail problem - the coupon is already on screen.
      this.logger.error(`Failed to send reward e-mail to ${payload.to}: ${(error as Error).message}`);
      return false;
    }
  }

  private buildHtml(payload: CouponMailPayload): string {
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="background:#4f46e5;padding:24px;color:#ffffff;">
          <h1 style="margin:0;font-size:20px;">Thanks for your feedback!</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
            Here is your reward for completing the survey.
          </p>
          <div style="border:2px dashed #c7d2fe;border-radius:12px;padding:20px;text-align:center;background:#eef2ff;">
            <div style="font-size:13px;color:#4338ca;text-transform:uppercase;letter-spacing:1px;">
              ${escape(payload.couponName)}${payload.couponValue ? ` &middot; ${escape(payload.couponValue)}` : ''}
            </div>
            <div style="font-size:26px;font-weight:700;letter-spacing:3px;margin-top:8px;">
              ${escape(payload.couponCode)}
            </div>
          </div>
          ${
            payload.expiresAt
              ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280;">Valid until ${escape(
                  payload.expiresAt.toDateString(),
                )}.</p>`
              : ''
          }
          <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">
            This coupon was issued for a single use. Please do not share it.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }
}
