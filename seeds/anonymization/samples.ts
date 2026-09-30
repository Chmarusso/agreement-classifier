import type { AgreementFormat, AgreementType } from "@app/domain";

/**
 * Agreements for trying the anonymizer by hand: upload them in the UI or run
 * `bun run anonymize seeds/anonymization/files/<file>`. Every person, number and
 * address is invented; identifiers are synthetic but pass their checksums.
 *
 * mustReplace: values that must not reach the model.
 * mustKeep: text that has to stay readable for the audit to work.
 */
export interface AnonymizationSample {
  slug: string;
  title: string;
  type: AgreementType;
  format: Exclude<AgreementFormat, "pdf"> | "pdf";
  language: "pl" | "en";
  /** What the sample is meant to exercise. */
  focus: string;
  markdown: string;
  mustReplace: string[];
  mustKeep: string[];
}

export const anonymizationSamples: AnonymizationSample[] = [
  {
    slug: "pl-umowa-zlecenia",
    title: "Umowa zlecenia – Katarzyna Zając",
    type: "Other",
    format: "docx",
    language: "pl",
    focus: "A private person as the contractor: PESEL, ID card, date of birth, bank account, and the name in five grammatical cases.",
    markdown: `# Umowa zlecenia

Zawarta w dniu 2 października 2026 r. w Warszawie pomiędzy Northwind Analytics sp. z o.o. z siedzibą w Warszawie, ul. Żurawia 6/12, 00-503 Warszawa, KRS 0000123456, NIP 5260250274, reprezentowaną przez Tomasza Wiśniewskiego – Członka Zarządu (dalej „Zleceniodawca”), a Panią Katarzyną Zając, urodzoną 15.03.1992 r., zamieszkałą w Krakowie, ul. Floriańska 20/4, 31-021 Kraków, PESEL 92031507849, legitymującą się dowodem osobistym AYW952341 (dalej „Zleceniobiorca”).

## § 1. Przedmiot umowy
Zleceniodawca powierza Katarzynie Zając przygotowanie raportu z analizy danych sprzedażowych za rok 2025.

## § 2. Wynagrodzenie
Za wykonanie zlecenia Zleceniobiorca otrzyma wynagrodzenie w kwocie 8 500 zł brutto, płatne w terminie 14 dni od doręczenia rachunku, na rachunek bankowy nr PL81 1050 1445 1000 0022 7463 5201 prowadzony dla Katarzyny Zając.

## § 3. Kontakt
Wszelką korespondencję do Zleceniobiorcy kieruje się na adres e-mail k.zajac@poczta.example lub telefonicznie pod numerem 600-700-800. Ze strony Zleceniodawcy osobą kontaktową jest Pan Tomasz Wiśniewski, tel. +48 22 628 11 22.

## § 4. Poufność
Pani Zając zachowa w tajemnicy informacje uzyskane w związku z wykonywaniem zlecenia przez trzy (3) lata od zakończenia umowy.

## § 5. Postanowienia końcowe
Umowa podlega prawu polskiemu. Spory rozstrzyga sąd powszechny właściwy dla siedziby Zleceniodawcy.

## § 6. Podpisy stron
Zleceniodawca:
Imię i nazwisko: Tomasz Wiśniewski
Stanowisko: Członek Zarządu

Zleceniobiorca:
Imię i nazwisko: Katarzyna Zając
`,
    mustReplace: [
      "Katarzyną Zając",
      "Katarzynie Zając",
      "Katarzyny Zając",
      "Katarzyna Zając",
      "Pani Zając",
      "Tomasza Wiśniewskiego",
      "Tomasz Wiśniewski",
      "92031507849",
      "AYW952341",
      "15.03.1992",
      "ul. Floriańska 20/4",
      "PL81 1050 1445 1000 0022 7463 5201",
      "k.zajac@poczta.example",
      "600-700-800",
      "+48 22 628 11 22",
      "5260250274",
      "0000123456",
    ],
    mustKeep: ["8 500 zł", "2 października 2026", "14 dni", "trzy (3) lata", "prawu polskiemu", "§ 4. Poufność", "Northwind Analytics"],
  },
  {
    slug: "pl-umowa-najmu",
    title: "Umowa najmu lokalu mieszkalnego",
    type: "Other",
    format: "md",
    language: "pl",
    focus:
      "Two private persons, a hyphenated surname, a long surname in the instrumental case, the flat's address and land register number.",
    markdown: `# Umowa najmu lokalu mieszkalnego

Zawarta w Warszawie w dniu 1 listopada 2026 r. pomiędzy:

Panią Joanną Nowak-Kowalską, zamieszkałą w Warszawie, ul. Puławska 145/7, 02-715 Warszawa, PESEL 85071203468, zwaną dalej „Wynajmującym”,

a

Panem Grzegorzem Brzęczyszczykiewiczem, zamieszkałym w Łodzi, ul. Piotrkowska 101, 90-425 Łódź, PESEL 78112301577, zwanym dalej „Najemcą”.

## § 1
Przedmiot najmu
Wynajmujący oddaje Najemcy do używania lokal mieszkalny położony przy ul. Marszałkowskiej 84/92 m. 15, 00-514 Warszawa, dla którego Sąd Rejonowy dla Warszawy-Mokotowa prowadzi księgę wieczystą nr WA4M/00123456/7.

## § 2
Czynsz
Najemca płaci czynsz w wysokości 4 200 zł miesięcznie do 10. dnia każdego miesiąca na rachunek Wynajmującego nr 86 1240 1023 1111 0000 1234 5678.

## § 3
Kaucja
Pan Brzęczyszczykiewicz wpłaca kaucję w wysokości 8 400 zł. Joanna Nowak-Kowalska zwraca kaucję w ciągu 30 dni od zwrotu lokalu.

## § 4
Wypowiedzenie
Każda ze stron może wypowiedzieć umowę z zachowaniem trzymiesięcznego okresu wypowiedzenia.

## § 5
Podpisy stron
Wynajmujący: Joanna Nowak-Kowalska
Najemca: Grzegorz Brzęczyszczykiewicz
`,
    mustReplace: [
      "Joanną Nowak-Kowalską",
      "Joanna Nowak-Kowalska",
      "Grzegorzem Brzęczyszczykiewiczem",
      "Grzegorz Brzęczyszczykiewicz",
      "Pan Brzęczyszczykiewicz",
      "ul. Puławska 145/7",
      "ul. Piotrkowska 101",
      "ul. Marszałkowskiej 84/92",
      "85071203468",
      "78112301577",
      "86 1240 1023 1111 0000 1234 5678",
      "WA4M/00123456/7",
    ],
    mustKeep: ["4 200 zł", "8 400 zł", "30 dni", "trzymiesięcznego okresu wypowiedzenia", "Sąd Rejonowy dla Warszawy-Mokotowa"],
  },
  {
    slug: "pl-nda-spolki",
    title: "Umowa o zachowaniu poufności – Wisła Data Solutions S.A.",
    type: "NDA",
    format: "txt",
    language: "pl",
    focus:
      "Companies only: KRS, NIP and REGON in different notations, board members, landline in brackets, the company's own name on the keep list.",
    markdown: `# Umowa o zachowaniu poufności

Zawarta pomiędzy Northwind Analytics sp. z o.o. z siedzibą w Warszawie (NIP: 526-025-02-74, REGON: 123456785), reprezentowaną przez Annę Kowalską – Prezesa Zarządu, a Wisła Data Solutions S.A. z siedzibą w Krakowie, ul. Długa 15, 31-147 Kraków, wpisaną do rejestru przedsiębiorców pod nr KRS 0000654321, NIP 677-22-46-017, REGON 356000122, reprezentowaną przez Pana Jana Nowaka – Członka Zarządu oraz Panią Ewę Lewandowską – Prokurenta.

## § 1. Informacje poufne
Informacjami Poufnymi są wszelkie informacje handlowe, techniczne i finansowe przekazane przez jedną Stronę drugiej Stronie.

## § 2. Okres obowiązywania
Obowiązek poufności trwa przez pięć (5) lat od rozwiązania Umowy. Każda ze Stron może rozwiązać Umowę z zachowaniem 30-dniowego okresu wypowiedzenia.

## § 3. Odpowiedzialność
Odpowiedzialność każdej ze Stron jest ograniczona do kwoty 200 000 zł, z wyjątkiem szkody wyrządzonej umyślnie.

## § 4. Osoby kontaktowe
Po stronie Wisła Data Solutions: Ewa Lewandowska, e-mail: ewa.lewandowska@wisla-data.example, tel. (12) 345 67 89. Po stronie Spółki: biuro@northwind.example.

## § 5. Prawo i spory
Umowa podlega prawu polskiemu. Spory rozstrzyga Sąd Okręgowy w Warszawie.

## § 6. Podpisy stron
Za Spółkę: Anna Kowalska, Prezes Zarządu
Za Wisła Data Solutions S.A.: Jan Nowak, Członek Zarządu; Ewa Lewandowska, Prokurent
`,
    mustReplace: [
      "Wisła Data Solutions S.A.",
      "Annę Kowalską",
      "Anna Kowalska",
      "Jana Nowaka",
      "Jan Nowak",
      "Ewę Lewandowską",
      "Ewa Lewandowska",
      "ewa.lewandowska@wisla-data.example",
      "(12) 345 67 89",
      "526-025-02-74",
      "677-22-46-017",
      "123456785",
      "356000122",
      "0000654321",
      "ul. Długa 15",
    ],
    mustKeep: ["Northwind Analytics", "pięć (5) lat", "200 000 zł", "Sąd Okręgowy w Warszawie", "prawu polskiemu"],
  },
  {
    slug: "en-consulting-agreement-uk",
    title: "Consulting Agreement – Acme Consulting Ltd",
    type: "MSA",
    format: "pdf",
    language: "en",
    focus: "UK style: company number, VAT number, National Insurance number, postcode, +44 phone, IBAN, surname-only references.",
    markdown: `# Consulting Agreement

This Consulting Agreement is made on 5 October 2026 between Northwind Analytics sp. z o.o., Warsaw, Poland (the "Company"), and Acme Consulting Ltd, a company registered in England and Wales under company number 01234567, VAT number GB123456789, whose registered office is at 221B Baker Street, London NW1 6XE (the "Consultant"), represented by John Smith, Director.

## 1. Services
The Consultant shall provide data governance consulting. The services will be performed personally by Mr Smith, National Insurance number QQ123456C, unless the Company agrees otherwise in writing.

## 2. Fees
The Company pays GBP 950 per day. Invoices are payable within 30 days to the Consultant's account IBAN GB82 WEST 1234 5698 7654 32.

## 3. Termination
Either party may terminate this Agreement on thirty (30) days' written notice.

## 4. Notices
Notices to the Consultant go to John Smith at john.smith@acme-consulting.example or +44 20 7946 0958. Notices to the Company go to legal@northwind.example.

## 5. Governing law
This Agreement is governed by the laws of Poland. Disputes shall be resolved by the common courts in Warsaw.

## 6. Signatures
For the Company:
Name: Anna Kowalska
Title: Chief Executive Officer

For the Consultant:
Name: John Smith
Title: Director
`,
    mustReplace: [
      "Acme Consulting Ltd",
      "John Smith",
      "Mr Smith",
      "Anna Kowalska",
      "01234567",
      "GB123456789",
      "QQ123456C",
      "221B Baker Street",
      "NW1 6XE",
      "GB82 WEST 1234 5698 7654 32",
      "john.smith@acme-consulting.example",
      "+44 20 7946 0958",
    ],
    mustKeep: ["GBP 950 per day", "thirty (30) days", "laws of Poland", "Northwind Analytics", "5 October 2026"],
  },
  {
    slug: "en-employment-us",
    title: "Employment Agreement – Jane Doe",
    type: "Employment",
    format: "docx",
    language: "en",
    focus: "US style: SSN, date of birth, passport, corporate card, US address and phone.",
    markdown: `# Employment Agreement

This Employment Agreement is made between Northwind Analytics Inc., a Delaware corporation (the "Company"), and Jane Doe, born on March 3, 1990, residing at 1600 Amphitheatre Parkway, Mountain View, CA 94043, Social Security Number 536-22-1234, passport number 563891247 (the "Employee").

## 1. Position
The Company employs Ms Doe as Senior Data Engineer from January 4, 2027.

## 2. Compensation
The Employee receives an annual base salary of USD 165,000. Business expenses are paid with the corporate card 4111 1111 1111 1111 issued to Jane Doe.

## 3. Confidentiality
The Employee shall keep the Company's confidential information secret during employment and for three (3) years after it ends.

## 4. Contact
The Employee's personal e-mail is jane.doe@mail.example and phone +1 (415) 555-0100. Her manager is Dr Robert Chen.

## 5. Governing law
This Agreement is governed by the laws of Poland.

## 6. Signatures
For the Company:
Name: Robert Chen
Title: VP Engineering

Employee:
Name: Jane Doe
`,
    mustReplace: [
      "Jane Doe",
      "Ms Doe",
      "Robert Chen",
      "March 3, 1990",
      "1600 Amphitheatre Parkway",
      "CA 94043",
      "536-22-1234",
      "563891247",
      "4111 1111 1111 1111",
      "jane.doe@mail.example",
      "+1 (415) 555-0100",
    ],
    mustKeep: ["USD 165,000", "three (3) years", "January 4, 2027", "laws of Poland", "Senior Data Engineer"],
  },
  {
    slug: "bilingual-service-agreement",
    title: "Umowa o świadczenie usług / Service Agreement",
    type: "MSA",
    format: "md",
    language: "pl",
    focus: "Bilingual Polish/English text: the same people and numbers must get the same placeholder in both languages.",
    markdown: `# Umowa o świadczenie usług / Service Agreement

Umowa zawarta pomiędzy Northwind Analytics sp. z o.o. a Baltic Code sp. z o.o., NIP 9510021388, reprezentowaną przez Marka Zielińskiego.
This Agreement is made between Northwind Analytics sp. z o.o. and Baltic Code sp. z o.o., tax number 9510021388, represented by Marek Zieliński.

## § 1. Usługi / Services
Wykonawca świadczy usługi programistyczne. Kierownikiem projektu jest Pani Olga Kamińska (olga.kaminska@balticcode.example).
The Contractor provides software development services. The project manager is Ms Olga Kamińska (olga.kaminska@balticcode.example).

## § 2. Wynagrodzenie / Fees
Wynagrodzenie wynosi 30 000 zł miesięcznie, płatne w terminie 45 dni na rachunek PL86 1240 1023 1111 0000 1234 5678.
The fee is PLN 30,000 per month, payable within 45 days to account PL86 1240 1023 1111 0000 1234 5678.

## § 3. Prawo właściwe / Governing law
Umowa podlega prawu polskiemu. / This Agreement is governed by the laws of Poland.

## § 4. Podpisy / Signatures
Imię i nazwisko / Name: Marek Zieliński
Stanowisko / Title: Prezes Zarządu / President of the Management Board
`,
    mustReplace: [
      "Baltic Code sp. z o.o.",
      "Marka Zielińskiego",
      "Marek Zieliński",
      "Olga Kamińska",
      "olga.kaminska@balticcode.example",
      "9510021388",
      "PL86 1240 1023 1111 0000 1234 5678",
    ],
    mustKeep: ["30 000 zł", "PLN 30,000", "45 dni", "laws of Poland", "prawu polskiemu", "Northwind Analytics"],
  },
];

export const sampleFileName = (s: AnonymizationSample) => `${s.slug}.${s.format}`;
