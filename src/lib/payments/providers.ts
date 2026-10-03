/**
 * Payment gateway registry.
 *
 * READ THIS BEFORE ASSUMING A GATEWAY WORKS.
 *
 * A row in this file is a *candidate*, not an integration. Going from candidate
 * to working automatic payments needs, for every provider:
 *
 *   1. a merchant account, approved and KYC'd by that provider
 *   2. live API credentials, stored as Supabase *server* secrets (never in the
 *      client, never in localStorage - see why at the bottom)
 *   3. the provider's request-signing scheme implemented server-side
 *   4. a webhook URL registered with the provider that we verify on arrival
 *
 * None of that can be faked in a dropdown. Until a provider has credentials,
 * `configured` is false, the UI refuses to route money to it, and deposits stay
 * on the MANUAL path - which works today with zero credentials and is honestly
 * labelled as manual. That is deliberate: a gateway that looks live but silently
 * drops a customer's money is far worse than one that says "not configured".
 *
 * CURRENCY IS THE FILTER THAT MATTERS. Razorpay is the one name people reach for
 * first and it is the wrong answer for this app: Razorpay settles in INR only
 * and does not accept BDT. A BDT app integrating it would either reject every
 * transaction or silently convert at a rate the player never agreed to. It is
 * listed below, marked, rather than quietly omitted - so nobody re-adds it later.
 */

export type GatewayId =
  | 'manual'
  | 'bkash'
  | 'nagad'
  | 'rocket'
  | 'sslcommerz'
  | 'aamarpay'
  | 'portwallet'
  | 'shurjopay'
  | 'lazypay'
  | 'razorpay'

/** How money actually moves for each provider. Drives which flow the UI shows. */
export type GatewayFlow =
  /** no redirect: app deep-links the wallet, then the player submits the TxID */
  | 'wallet_redirect'
  /** no redirect: app opens the merchant's own payment page */
  | 'hosted_redirect'
  /** card/wallet page hosted by the provider, player returns to the app */

export interface Gateway {
  id: GatewayId
  label: string
  /** currencies the provider settles in, lower case */
  currencies: string[]
  flow: GatewayFlow
  /** the merchant never sees the gateway secret; these are what we need */
  secrets: string[]
  docs: string
  /** true when the provider cannot handle BDT at all */
  notForThisApp?: boolean
  note?: string
}

export const GATEWAYS: Gateway[] = [
  {
    id: 'manual',
    label: 'Manual (no gateway)',
    currencies: ['bdt'],
    flow: 'wallet_redirect',
    secrets: [],
    docs: '',
    note: 'The player sends the transfer and an admin approves it in the admin panel. No credentials needed, works today.',
  },
  {
    id: 'bkash',
    label: 'bKash',
    currencies: ['bdt'],
    flow: 'wallet_redirect',
    secrets: ['BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_USERNAME', 'BKASH_PASSWORD'],
    docs: 'https://developer.bka.sh/',
    note: 'Tokenized checkout. Needs a live bKash merchant wallet and app credentials from bKash Developer.',
  },
  {
    id: 'nagad',
    label: 'Nagad',
    currencies: ['bdt'],
    flow: 'wallet_redirect',
    secrets: ['NAGAD_APP_KEY', 'NAGAD_APP_SECRET', 'NAGAD_MERCHANT_ID'],
    docs: 'https://developer.nagad.com.bd/',
    note: 'Nagad PGW. Needs a merchant account approved by Nagad.',
  },
  {
    id: 'rocket',
    label: 'Rocket',
    currencies: ['bdt'],
    flow: 'wallet_redirect',
    secrets: ['ROCKET_MERCHANT_ID', 'ROCKET_API_KEY'],
    docs: 'https://developer.rocket.com.bd/',
    note: 'DBBL Rocket. Merchant approval required; sandbox availability is limited.',
  },
  {
    id: 'sslcommerz',
    label: 'SSLCOMMERZ',
    currencies: ['bdt'],
    flow: 'hosted_redirect',
    secrets: ['SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_STORE_PASSWORD', 'SSLCOMMERZ_SANDBOX'],
    docs: 'https://developer.sslcommerz.com/',
    note: 'Easiest first integration in Bangladesh: sandbox keys are self-service, and it handles bKash/Nagad/cards behind one API.',
  },
  {
    id: 'aamarpay',
    label: 'aamarPay',
    currencies: ['bdt'],
    flow: 'hosted_redirect',
    secrets: ['AAMARPAY_STORE_ID', 'AAMARPAY_SIGNATURE_KEY', 'AAMARPAY_SANDBOX'],
    docs: 'https://aamarpay.com/developer/',
    note: 'Aggregator covering bKash, Nagad, Rocket, cards and bank transfer behind one checkout.',
  },
  {
    id: 'portwallet',
    label: 'Portwallet',
    currencies: ['bdt'],
    flow: 'hosted_redirect',
    secrets: ['PORTWALLET_MERCHANT_ID', 'PORTWALLET_API_KEY', 'PORTWALLET_BASE_URL'],
    docs: 'https://developer.portwallet.com/',
    note: 'Covers mobile financial services and cards. Sandbox available after signup.',
  },
  {
    id: 'shurjopay',
    label: 'ShurjoPay',
    currencies: ['bdt'],
    flow: 'hosted_redirect',
    secrets: ['SHURJOPAY_MERCHANT_ID', 'SHURJOPAY_SECRET', 'SHURJOPAY_SANDBOX'],
    docs: 'https://developer.shurjopay.com/',
    note: 'BD gateway with card and MFS support plus a sandbox.',
  },
  {
    id: 'lazypay',
    label: 'LazyPay',
    currencies: ['bdt'],
    flow: 'hosted_redirect',
    secrets: ['LAZYPAY_MERCHANT_KEY', 'LAZYPAY_SECRET_KEY'],
    docs: 'https://docs.lazypay.com/',
    note: 'Merchant onboarding is approval-based, so plan this one later.',
  },
  {
    id: 'razorpay',
    label: 'Razorpay (INR only - not usable for BDT)',
    currencies: ['inr'],
    flow: 'hosted_redirect',
    secrets: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    docs: 'https://razorpay.com/docs/',
    notForThisApp: true,
    note: 'Does not settle in BDT and will not accept a taka transaction. Listed only so it is not reintroduced as if it were an option.',
  },
]

export const APP_CURRENCY = 'bdt'
export const byId = (id: string): Gateway | undefined => GATEWAYS.find((g) => g.id === id)

/** A gateway we could actually route money to today. */
export const isUsable = (g: Gateway): boolean =>
  !g.notForThisApp && g.currencies.includes(APP_CURRENCY) && g.id !== 'manual'
