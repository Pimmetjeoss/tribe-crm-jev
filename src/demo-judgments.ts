import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

export const demoGroups = [
  { id: "entities", title: "Wie & context", blurb: "Wat hoort als relatie in Tribe?" },
  { id: "intent", title: "Intentie", blurb: "Wat wil de afzender bereiken?" },
  { id: "sales", title: "Commerciële signalen", blurb: "Is dit een kans en hoe sterk is die?" },
  { id: "routing", title: "CRM-route", blurb: "Welke behandeling past hierbij?" },
] as const;

export const demoQuestionMeta = [
  { id: "hasPerson", label: "Specifieke persoon", group: "entities", kind: "noul" },
  { id: "hasOrganization", label: "Specifieke organisatie", group: "entities", kind: "noul" },
  { id: "existingRelationship", label: "Bestaande relatie", group: "entities", kind: "noul" },
  { id: "identityAmbiguity", label: "Identiteit is ambigu", group: "entities", kind: "noul" },
  { id: "intent", label: "Primaire intentie", group: "intent", kind: "choice" },
  { id: "lifecycle", label: "Relatiefase", group: "intent", kind: "choice" },
  { id: "requestedChannel", label: "Gewenst contactkanaal", group: "intent", kind: "choice" },
  { id: "asksFollowUp", label: "Vraagt om opvolging", group: "intent", kind: "noul" },
  { id: "commercialInterest", label: "Commerciële interesse", group: "sales", kind: "noul" },
  { id: "quotationRequest", label: "Offerte gevraagd", group: "sales", kind: "noul" },
  { id: "timelinePresent", label: "Concrete tijdslijn", group: "sales", kind: "noul" },
  { id: "decisionMakerSignal", label: "Beslisserssignaal", group: "sales", kind: "noul" },
  { id: "urgency", label: "Urgentie", group: "sales", kind: "score", max: 3 },
  { id: "opportunityStrength", label: "Opportunity-sterkte", group: "sales", kind: "score", max: 3 },
  { id: "informationCompleteness", label: "Compleetheid", group: "routing", kind: "score", max: 3 },
  { id: "crmAction", label: "Aanbevolen CRM-actie", group: "routing", kind: "choice" },
] as const;

export const demoQuestions = {
  hasPerson: noul("Identificeert `message` een specifieke echte persoon die als persoon in een CRM thuishoort?", {
    true: "Een specifieke persoon wordt bij naam of ondubbelzinnige identiteit genoemd.",
    false: "Er wordt geen specifieke persoon geïdentificeerd.",
  }),
  hasOrganization: noul("Identificeert `message` een specifieke organisatie die als organisatie in een CRM thuishoort?", {
    true: "Een specifieke onderneming of organisatie wordt genoemd.",
    false: "Er wordt geen specifieke organisatie geïdentificeerd.",
  }),
  existingRelationship: noul("Geeft `message` aan dat de afzender al klant, leverancier, partner of bestaande relatie is?", {
    true: "De tekst bevat expliciete signalen van een bestaande zakelijke relatie.",
    false: "De relatie is nieuw of de tekst bevat geen bewijs van een bestaande relatie.",
  }),
  identityAmbiguity: noul("Is het onduidelijk welke persoon of organisatie in `message` als primaire CRM-relatie bedoeld wordt?", {
    true: "Meerdere mogelijke identiteiten of onvoldoende identificerende context maken de primaire relatie ambigu.",
    false: "De primaire relatie is duidelijk of er wordt bewust geen relatie genoemd.",
  }),
  intent: choice("Wat is de primaire zakelijke intentie van `message`?", {
    sales: "Een mogelijke koper, offerteaanvraag of concrete commerciële behoefte.",
    support: "Hulp bij een bestaand product, dienst, bestelling of account.",
    supplier: "Inkoop, leverancier of aanbod om iets aan ons te leveren.",
    partnership: "Samenwerking of partnerschap zonder directe koop- of verkoopvraag.",
    other: "Geen van de andere zakelijke intenties past duidelijk.",
  }),
  lifecycle: choice("Welke relatiefase blijkt het best uit `message`?", {
    new_lead: "Een nieuwe onbekende prospect of eerste commerciële benadering.",
    existing_customer: "Een expliciete bestaande klantrelatie.",
    partner_or_supplier: "Een partner- of leveranciersrelatie.",
    unknown: "De fase is niet betrouwbaar uit de tekst af te leiden.",
  }),
  requestedChannel: choice("Via welk kanaal vraagt `message` bij voorkeur om een reactie?", {
    email: "De afzender vraagt expliciet om e-mail of een schriftelijke reactie.",
    phone: "De afzender vraagt expliciet om bellen of telefonisch contact.",
    meeting: "De afzender vraagt expliciet om een afspraak, demo of vergadering.",
    unspecified: "Er is geen voorkeurskanaal opgegeven.",
  }),
  asksFollowUp: noul("Vraagt `message` expliciet of impliciet om een zakelijke vervolgactie?", {
    true: "Er wordt om reactie, contact, informatie, offerte, afspraak of oplossing gevraagd.",
    false: "Er wordt geen vervolgactie verwacht.",
  }),
  commercialInterest: noul("Bevat `message` concrete interesse in het kopen of afnemen van een product of dienst?", {
    true: "Er is een koopbehoefte, project, use-case of concrete interesse.",
    false: "Er is geen concrete koopinteresse.",
  }),
  quotationRequest: noul("Vraagt `message` om een offerte, prijsindicatie of commercieel voorstel?", {
    true: "Een offerte, prijs, kosteninschatting of voorstel wordt gevraagd.",
    false: "Een dergelijke vraag ontbreekt.",
  }),
  timelinePresent: noul("Noemt `message` een concrete deadline, periode of gewenste startdatum?", {
    true: "Er staat een bruikbare tijdsaanduiding voor opvolging of uitvoering.",
    false: "Er staat geen concrete tijdsaanduiding.",
  }),
  decisionMakerSignal: noul("Geeft `message` aanwijzingen dat de afzender invloed heeft op de aankoopbeslissing?", {
    true: "De afzender spreekt namens het team of bedrijf, vraagt een voorstel of beschrijft besliscriteria.",
    false: "Er is geen bewijs van invloed op de aankoopbeslissing.",
  }),
  urgency: score("Hoe urgent is zakelijke opvolging van `message`?", [
    "Geen opvolging of geen tijdsdruk.",
    "Normale opvolging binnen het gewone proces.",
    "Snelle opvolging is nuttig vanwege een nabije behoefte.",
    "Onmiddellijke opvolging is nodig door een expliciete deadline of grote impact.",
  ]),
  opportunityStrength: score("Hoe sterk is de onderbouwde sales opportunity in `message`?", [
    "Geen aantoonbare sales opportunity.",
    "Zwak of verkennend signaal zonder concrete behoefte.",
    "Duidelijke behoefte met bruikbare commerciële context.",
    "Zeer concrete kans met behoefte en sterke koop- of vervolgsignalen.",
  ]),
  informationCompleteness: score("Hoe compleet is `message` voor veilige CRM-opvolging?", [
    "Geen bruikbare identiteit, behoefte of vervolginformatie.",
    "Enkele bruikbare gegevens, maar essentiële context ontbreekt.",
    "Grotendeels bruikbaar; slechts beperkte context ontbreekt.",
    "Compleet genoeg met duidelijke identiteit, behoefte en gewenste vervolgstap.",
  ]),
  crmAction: choice("Welke eerstvolgende CRM-behandeling past het best bij `message`?", {
    create_opportunity: "Maak of suggereer een opportunity voor concrete koopinteresse.",
    sales_follow_up: "Plan sales-opvolging, maar maak nog niet automatisch een opportunity.",
    support_route: "Routeer naar support voor een bestaande dienst of klantvraag.",
    human_review: "Laat een mens de identiteit of bedoeling beoordelen.",
    no_action: "Er is geen zinvolle CRM-actie nodig.",
  }),
} as const;

export async function judgeDemoText(text: string, client = new TypeSafeClient()) {
  return client.systemOne({
    state: { message: text },
    questions: demoQuestions,
  });
}
