# UAE VAT facts for the UAE regulation pack (research round AE0, 2026-10-12)

**Why this file exists.** Round AE1 builds `reg-ae.js` for the engines from this file alone, so every rule below carries the URL
and the article, clause or guide page it was read from. Official sources only: tax.gov.ae (Federal Tax Authority, "FTA"),
mof.gov.ae (Ministry of Finance, "MoF"), and the neighbouring authorities' own sites for the region paragraph. Where a fact
could not be found in an official source the cell says **not found in an official source** rather than guessing.

**How it was read.** The FTA publishes the law as consolidated unofficial English translations. The texts quoted here are the
latest consolidations the FTA serves today: the Decree-Law as amended to Federal Decree-Law No. 16 of 2024 (effective
30 Oct 2024) and the Executive Regulation as amended to Cabinet Decision No. 100 of 2024 (effective 15 Nov 2024). The PDFs were
fetched and their text extracted on 2026-10-12; quotes are verbatim from those extractions. Short names used below:

| Short name | Document | URL |
|---|---|---|
| **DL** | Federal Decree-Law No. 8 of 2017 on Value Added Tax and its amendments (FTA consolidation, 2025) | https://tax.gov.ae/Datafolder/Files/Legislation/2025/Federal-Decree-Law-No-8-of-2017-and-amendments.pdf |
| **ER** | Cabinet Decision No. 52 of 2017, Executive Regulation of the VAT Decree-Law, and its amendments (FTA consolidation published 04 Oct 2024) | https://tax.gov.ae/Datafolder/Files/Legislation/Executive%20Regulation%20of%20Federal%20Decree%20Law%20No%208%20of%202017%20-%20Publish%20-%2004%2010%202024.pdf |
| **VATP040** | FTA Public Clarification VATP040, Amendments to the Executive Regulation, Cabinet Decision No. 100 of 2024 (14 Mar 2025) | https://tax.gov.ae/Datafolder/Files/Pdf/2025/VATP040%20-%20Amendments%20to%20VAT%20ER%20-%2014%2003%202025.pdf |
| **TPL** | Federal Decree-Law No. 28 of 2022 on Tax Procedures and its amendments (consolidation published 03 Dec 2025) | https://tax.gov.ae/Datafolder/Files/Legislation/2025/Federal%20Decree-Law%20No.%2028%20of%202022%20-%20publishing%2003%2012%202025.pdf |
| **TPL-ER** | Cabinet Decision No. 74 of 2023, Executive Regulation of the Tax Procedures Law | https://tax.gov.ae/Datafolder/Files/Legislation/Cabinet%20Decision%20No.%2074%20of%202023%20on%20Executive%20Regulation%20of%20Federal%20Decree-Law%20No.%2028%20of%202022%20on%20Tax%20Procedures%20-%20For%20Publishing.pdf |
| **RET** | FTA "VAT User Guide \| Returns", August 2021 (VAT201 box-by-box guide) | https://tax.gov.ae/DataFolder/Files/Pdf/VAT%20Returns%20User%20GuideEnglishV40%2015%2008%202021%20SEP2021.pdf |
| **RET-UM** | FTA "VAT Returns form - VAT 201 - Taxpayer User Manual", EmaraTax, Oct 2022, v1.0.0.0 | https://tax.gov.ae/DownloadOpenTextFile?fileUrl=en%2FVAT_VAT_Guides%2FVAT_Returns_form%2FProcess_the_VAT_201_returns_form_EN.pdf |
| **DZ** | FTA list "Designated Zones for the purposes of the Federal Decree-Law No. (8) of 2017" (Cabinet Decision 59 of 2017 as amended by 35 of 2018) | https://tax.gov.ae/-/media/Files/FTA/links/Legislation/VAT/ar/05-designated-zones.pdf |
| **MD243** | Ministerial Decision No. 243 of 2025 on the Electronic Invoicing System | https://mof.gov.ae/wp-content/uploads/2025/09/Ministerial-Decision-no.-243-of-2025-on-the-Electronic-Invoicing-System.pdf |
| **MD244** | Ministerial Decision No. 244 of 2025 on the Implementation of the Electronic Invoicing System | https://mof.gov.ae/wp-content/uploads/2025/09/Ministerial-Decision-No.-244-of-2025-on-the-Implementation-of-the-Electronic-Invoicing-System.pdf |
| **MD66** | Ministerial Decision No. 66 of 2026 amending MD244 | https://mof.gov.ae/wp-content/uploads/2026/05/Ministerial-Resolution-No.-66-of-2026-Amending-Certain-Provisions-of-Ministerial-Resolution-No.-244-of-2025-Regarding-the-Implementation-of-the-Electronic-Invoicing-System-En-20260514.pdf |
| **CD106** | Cabinet Decision No. 106 of 2025 on e-invoicing violations and penalties | https://mof.gov.ae/wp-content/uploads/2025/12/Cabinet-Decision-Violations-and-Penalties-eInvoicing-final-version-en-8.12.25.pdf |
| **EI-GL** | MoF "UAE Electronic Invoicing Guidelines" v1.1, 1 June 2026 | https://mof.gov.ae/wp-content/uploads/2026/06/UAE-Electronic-Invoicing-Guidelines_V-1.1-01June2026.pdf |
| **EI-MF** | MoF "UAE Electronic Invoice Mandatory Fields" v1.0, 23 Feb 2026 | https://mof.gov.ae/wp-content/uploads/2026/02/UAE-Electronic-Invoice-mandatory-fields_V-1.0-23Feb2026.pdf |
| **CTL** | Federal Decree-Law No. 47 of 2022 on the Taxation of Corporations and Businesses and its amendments (MoF, Jan 2026) | https://mof.gov.ae/wp-content/uploads/2026/01/Federal-Decree-Law-No.-47-of-2022-and-its-amendments-en-v13.1.26.pdf |
| **CD116** | Cabinet Decision No. 116 of 2022 on the annual Taxable Income subject to Corporate Tax | https://mof.gov.ae/wp-content/uploads/2023/02/Cabinet-Decision-No-116-of-2022-on-CT-Article-3-Threshold-1.pdf |
| **MD73** | Ministerial Decision No. 73 of 2023 on Small Business Relief | https://mof.gov.ae/wp-content/uploads/2023/04/Ministerial-Decision-No.-73-of-2023-on-Small-Business-Relief-for-the-Purposes-of-Federal-Decree-Law-No.-47-of-2022.pdf |
| **CD142** | Cabinet Decision No. 142 of 2024 on the Imposition of Top-up Tax on Multinational Enterprises | https://tax.gov.ae/Datafolder/Files/Legislation/Cabinet-Decision-No-142-of-2024-on-Top-up-Tax-on-MNEs.pdf |

---

## 1. Currency, minor unit and rounding

| Rule | What the law says (quoted) | Source |
|---|---|---|
| Invoice currency | "If the supply is in a currency other than the UAE Dirham, then for the purposes of the Tax Invoice, the amount stated in the Tax Invoice shall be converted into the UAE Dirham according to the exchange rate approved by the Central Bank of the State at the date of supply." | DL Art. 69 |
| Amounts on the invoice are in AED | Full tax invoice: "the unit price, the quantity or volume supplied, the rate of Tax and the amount payable expressed in AED" (per line), "The gross amount payable expressed in AED", "The Tax amount charged under the provisions of the Decree-Law expressed in AED, together with the rate of exchange applied where the currency is converted from a currency other than the UAE dirham." Simplified: "The total Consideration and the Tax amount charged expressed in AED." | ER Art. 59(1)(h)(j)(k), 59(2)(e) |
| Minor unit | The return form takes "all amounts to the nearest fils (the form allows for two decimal places)" — so AED has 100 fils and the engine's minor unit is 0.01. | RET §3.2 "When completing each box" |
| Rounding rule | "Where the Tax chargeable on a supply is calculated to a fraction of a Fils, the Taxable Person is permitted to round the amount to the nearest Fils on a mathematical rounding." Note: it is **per supply** (each line / each supply, not the invoice total), it is **permitted, not required**, and "mathematical rounding" is half-up to 2 decimals. The Decree-Law delegates this: "the Executive Regulation … shall specify the method of calculation and stating the total amount to be paid if the Tax is less than one fils of a UAE Dirham." | ER Art. 61 "Fractions of Fils"; DL Art. 68 |
| Rounding in the e-invoice format | "Rounding off is applicable at the invoice level total up to 2 decimal places. Rounding off is not applicable at the tax category level or line-item level." (This is the PINT-AE document-level rounding field, i.e. a declared rounding amount on the total, not a change to Art. 61.) | EI-GL Appendix note 5 (p. 35) |
| Per-line VAT in AED in e-invoices | "It is mandatory to specify the VAT amount and the total amount payable in AED for each service or goods supplied … This requirement applies regardless of whether the invoice is issued in AED or any other currency." | EI-GL Appendix note 16 (p. 36); EI-MF fields 48–49 |
| Tax-inclusive display prices | Art. 38 "Tax-Inclusive Prices" exists in the DL (advertised prices include tax; exceptions in the ER). Full text not extracted this round. | DL Art. 38 (heading only) |

**For the pack:** `currency: 'AED'`, `invoice_round_to: 0.01` (the total is the sum of fils-rounded lines; a declared rounding
amount belongs only in the e-invoice document-level field), tax per line rounded half-up to the fils.

## 2. Tax periods and the return due date

| Rule | Quoted | Source |
|---|---|---|
| Standard period | "The standard Tax Period applicable to a Taxable Person shall be a period of three calendar months ending on the date that the Authority determines." | ER Art. 62(1) |
| Who decides | "the Authority may assign a Person or class of Persons a shorter or longer Tax Period where it considers that a non-standard Tax Period length is necessary or beneficial" (to reduce evasion risk, improve monitoring/collection, reduce burden). "Where a Taxable Person is assigned the standard Tax Period, he may request that the Tax Period ends with the month as requested by him, and the Authority may accept such request at its discretion." | ER Art. 62(2)(3); DL Art. 71 |
| Monthly filers | "The FTA may, at its discretion, assign a different Tax Period, other than the standard one, to a certain group of Taxable Persons (e.g. in some cases businesses may be required to file VAT returns on a monthly basis)." | RET §2.1 |
| The four staggers | Stagger 1 (tax year end 31 Jan): Feb–Apr, May–Jul, Aug–Oct, Nov–Jan · Stagger 2 (end Feb): Mar–May, Jun–Aug, Sep–Nov, Dec–Feb · Stagger 3 (end 31 Mar): Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar · Stagger 4 (end 31 Dec): Monthly. | RET §2.1 table |
| Due date | "A Tax Return must be received by the Authority no later than the 28th (twenty eighth) day following the end of the Tax Period concerned or by such other date as directed by the Authority." Payment: "so that it is received by the Authority no later than the date specified in Clause 1". | ER Art. 64(1)(3) |
| Weekend / holiday | "Where the due date … falls on a weekend or a national holiday, the deadline for filing the VAT Return or making a payment is extended to the first business day thereafter." | RET §2.1 |
| Nil return | "If there is no business transaction for the Tax Period, you are required to submit a 'nil' VAT Return by the respective due date." | RET §2.1 |
| Minimum return content | name/address/TRN; tax period; submission date; taxable supplies and output tax; zero-rated supplies; exempt supplies; supplies under Art. 48(1) and 48(3) (reverse charge); expenses on which input tax is sought and the recoverable tax; totals of due and recoverable tax; payable tax. | ER Art. 64(5)(a)–(j) |

## 3. Rates and categories

| Category | Rule (quoted / listed) | Source |
|---|---|---|
| Standard rate | "a standard rate of 5% Tax shall be imposed on any supply or Import pursuant to Article 2 of this Decree-Law on the value of the supply or Import" | DL Art. 3 |
| Zero rate (0%) — 14 heads | 1 direct or indirect export of goods and services outside the Implementing States · 2 international transport of passengers and goods starting/ending in or passing through the State, incl. transport-related services · 3 air passenger transport in the State that is "international carriage" under the Warsaw Convention · 4 supply or import of air, sea and land means of transport for passengers and goods · 5 goods/services for the operation, repair, maintenance or conversion of those means of transport · 6 air or sea rescue and assistance aircraft or vessels · 7 goods and services for consumption on board · 8 investment precious metals · 9 first supply of residential buildings within 3 years of completion · 10 first supply of buildings designed for charities · 11 first supply of buildings converted from non-residential to residential · 12 crude oil and natural gas · 13 educational services (nurseries, preschool, school, government-owned/funded higher education) · 14 preventive and basic healthcare services and related goods. Conditions in ER Arts. 30–41. | DL Art. 45 (as amended by DL 18 of 2022); ER Arts. 30–41 |
| Exempt — 4 heads | "1. Supply of financial services that are specified in the Executive Regulation … 2. Supply of residential buildings through sale or lease, other than that which is zero-rated … 3. Supply of bare land. 4. Supply of local passenger transport." | DL Art. 46; ER Arts. 42–45 |
| Out of scope | Not a defined category in the DL. Tax is imposed on "Every Taxable Supply and Deemed Supply made by the Taxable Person" and "Import of Concerned Goods" (Art. 2); anything else is outside Art. 2. Designated Zones are "treated as being outside the State" (Art. 50), and a document for a supply treated as made in another Implementing State "is not labelled 'Tax Invoice' and does not include any Tax charged" (Art. 66). | DL Arts. 2, 50, 66 |
| Return box examples | Box 4 zero-rated examples: exports; certain education; preventive and basic healthcare; investment precious metals; crude oil and natural gas. Box 5 exempt examples: certain financial services; residential buildings not zero-rated; bare land; local passenger transport. | RET Boxes 4 and 5 |

**For the pack:** `rates: [0, 5]` as the legal menu; the category (standard / zero / exempt / out-of-scope / reverse-charge)
is per supply and belongs to the line, exactly as the IN pack treats the HSN rate.

## 4. Tax Registration Number (TRN)

| Fact | Quoted | Source |
|---|---|---|
| Length | "Tax Identification Number ('TIN'): A unique 10-digit identifier and the first 10 digits of the 15-digit TRN issued to all entities registered with the UAE Federal Tax Authority." "The TIN is the first 10 digits of a Corporate Tax TRN." | EI-MF glossary rows 11–12 and §2 Highlights |
| Verification | The FTA TRN-verification field expects exactly 15 characters ("Please enter value of 15 characters long"); customs officers verify a TRN "by visiting the FTA website … and by using the feature of TRN verification". | FTA Tax Group user guide; FTA TRN–CRN linkage guide https://tax.gov.ae/DataFolder/Files/Pdf/TRNCRN%20Linkage%20Englishv20%2028%2009%202021.pdf |
| Check digit | **Not found in an official source.** No FTA or MoF document fetched describes a checksum or a fixed prefix; treat the format as 15 numeric characters, first 10 = TIN, and validate only length and digits. | — |
| Must appear on | "The Taxable Person … shall state the Tax Registration Number for Tax purposes on each Tax Return, notification, Tax Invoice, Tax Credit Note, and any other document related to Tax" | DL Art. 79 |
| Peppol endpoint | Seller electronic identifier "will be a fixed value 0235"; the Peppol participant identifier is "0235 followed by the 10-digit TIN". | EI-MF field 12; EI-GL glossary |

## 5. Registration thresholds

| Rule | Quoted | Source |
|---|---|---|
| Mandatory | "The Mandatory Registration Threshold shall be AED 375,000 (three hundred and seventy-five thousand dirhams)." Test: supplies "exceeded the Mandatory Registration Threshold over the previous 12-month period" or will exceed it "in the next 30 days". Application "within 30 days of being required to register". | ER Art. 7(1)(2); DL Art. 13(1) |
| Voluntary | "The Voluntary Registration Threshold shall be AED 187,500 (one hundred and eighty-seven thousand five hundred dirhams)." Supplies **or taxable expenses** in the previous 12 months, or expected in the next 30 days. | ER Art. 8(1); DL Art. 17 |
| Non-resident | "Every Person, who does not have a Place of Residence in the State or an Implementing State, shall register for Tax if he makes supplies of Goods or Services, and where no other Person is obligated to pay the Due Tax on these supplies in the State." (no threshold) | DL Art. 13(2) |
| What counts | taxable goods and services; concerned goods/services received; supplies of a business acquired; related parties' supplies. | DL Art. 19 |
| Processing time | "20 business days from the date the completed application was received" | FTA VAT registration service page https://tax.gov.ae/en/services/vat.registration.aspx |

## 6. Tax invoice — full and simplified

### 6.1 Who issues, when

| Rule | Quoted | Source |
|---|---|---|
| Obligation | "A Registrant making a Taxable Supply shall issue an original Tax Invoice and deliver it to the Recipient of Goods or Recipient of Services." Only registrants: Art. 59 "was amended to refer to a 'registrant' instead of a 'taxable person' as only registrants have TRNs and, therefore, only registrants can issue tax invoices". | DL Art. 65(1); VATP040 §Tax invoices |
| Definition | "Tax Invoice: A written or electronic document in which any Taxable Supply and its details are recorded, including an Electronic Invoice, as the case may be." | DL Art. 1 (amended by DL 16 of 2024) |
| Time limit | "The Registrant shall issue a Tax Invoice within 14 days from the date of supply as stated in Article 25 or Article 26". Exceptions (ER 59(13)): a simplified invoice "on the date of supply"; a summary invoice "within 14 (fourteen) days of the end of the calendar month within which the date of supply occurs"; other cases the Authority specifies. | DL Art. 67; ER Art. 59(13) |
| Summary invoice | "A Registrant shall not issue separate Tax Invoices in respect of supplies where he makes more than one supply of Goods or Services to the same Person and those supplies are included on a summary Tax Invoice issued and delivered to the Recipient". | ER Art. 59(6) |
| Wholly zero-rated supply | A tax invoice is not required "where the supply is a wholly zero-rated supply" if sufficient records exist. | ER Art. 59(3) |
| Electronic issue | Allowed if the registrant "must be capable of securely storing a copy" and "The authenticity of origin and integrity of content of the electronic Tax Invoice should be guaranteed." A registrant subject to the e-invoicing system "must issue and transmit Tax Invoices in the form of an Electronic Invoice". | ER Art. 59(8); DL Art. 65(5) |
| Self-billing | Recipient may raise the invoice if both are registrants, agreed in writing, full particulars, and "The words 'Tax Invoice raised by buyer' are clearly displayed". | ER Art. 59(9)(10) |
| Agent | A registrant agent may issue the invoice as if it made the supply, provided the principal does not, and both keep records of each other's name, address and TRN. | ER Art. 59(11) |
| GCC Implementing State supply | Add the recipient's tax registration number in that State and "a statement identifying the supply as between a supplier in the State and a Recipient … in an Implementing State"; the document must not be labelled "Tax Invoice" and carries no tax. | ER Art. 59(12); DL Art. 66 |

### 6.2 Full tax invoice — mandatory particulars (ER Art. 59(1), quoted)

| # | Particular |
|---|---|
| a | The words "Tax Invoice" clearly displayed on the invoice. |
| b | The name, address, and Tax Registration Number of the Registrant making the supply. |
| c | The name, address, and Tax Registration Number of the Recipient where he is a Registrant. |
| d | A sequential Tax Invoice number or a unique number which enables identification of the Tax Invoice and the order of the Tax Invoice in any sequence of invoices. |
| e | The date of issuing the Tax Invoice. |
| f | The date of supply if different from the date the Tax Invoice was issued. |
| g | A description of the Goods or Services supplied. |
| h | For each Good or Service, the unit price, the quantity or volume supplied, the rate of Tax and the amount payable expressed in AED. |
| i | The amount of any discount offered. |
| j | The gross amount payable expressed in AED. |
| k | The Tax amount charged under the provisions of the Decree-Law expressed in AED, together with the rate of exchange applied where the currency is converted from a currency other than the UAE dirham. |
| l | Where the invoice relates to a supply under which the Recipient of Goods or Recipient of Services is required to account for Tax, a statement that the Recipient is required to account for Tax, and a reference to the relevant provision of the Decree-Law. |

### 6.3 Simplified tax invoice — threshold, who may issue, particulars

| Rule | Quoted | Source |
|---|---|---|
| When allowed | "As an exception to Clause 4 of this Article, and in cases other than where the reverse charge mechanism applies in accordance with Article 48 of the Decree-Law, the Registrant may issue a simplified Tax Invoice … in either of the following two situations: a. Where the Recipient of Goods or Recipient of Services is not a Registrant. b. Where the Recipient of Goods or Recipient of Services is a Registrant and the Consideration for the supply does not exceed AED 10,000 (ten thousand dirhams)." | ER Art. 59(5) |
| Not for reverse charge | "simplified tax invoices are not allowed in instances where the reverse charge mechanism is applied under Article 48 of the Decree-Law, e.g. concerned services." | VATP040 |
| FTA may force a full invoice | "the Authority may specify the cases in which a Tax Invoice that meets the requirements of Clause 1 of this Article must be issued, even if one of the cases provided for in Clause 5 of this Article applies." | ER Art. 59(15) |
| Issue date | "where the Tax Invoice is issued in accordance with Clause 2 of this Article, the Registrant shall issue the Tax Invoice on the date of supply" | ER Art. 59(13)(1) |
| Particulars (ER Art. 59(2)) | a. The words "Tax Invoice" clearly displayed on the invoice. b. The name, address, and Tax Registration Number of the Registrant making the supply. c. The date of issuing the Tax Invoice. d. A description of the Goods or Services supplied. e. The total Consideration and the Tax amount charged expressed in AED. | ER Art. 59(2) |

### 6.4 The language rule (quoted exactly)

The VAT Decree-Law and its Executive Regulation contain **no language clause for the invoice itself** (ER Art. 59 and 60 were
read in full). The rule lives in the Tax Procedures Law:

> **TPL Art. 5 – Language.** "1. Every Person shall submit the Tax Return and any data, information, records and documents
> related to Tax that he is required to submit or otherwise requested to submit to the Authority in Arabic.
> 2. Notwithstanding Clause 1 of this Article, the Authority may accept the Tax Return, data, information, records, and
> documents related to the Tax in any other language, provided that the Person provides the Authority with a translated copy
> of any of these in Arabic if requested by the Authority, as specified in the Executive Regulation.
> 3. The Person who submits any translated copies of data, information, records and any other documents related to any Tax to
> the Authority shall be responsible for the accuracy and correctness of such translated copies, and shall bear all the
> associated costs. The Authority shall be entitled to rely on the translation provided."

> **TPL-ER Art. 5 – Language.** "1. The Authority may accept data, information, records and any other documents related to any
> Tax that are submitted to the Authority in English, and the Authority may, at its discretion, request the Person to translate
> some or all of them into Arabic. 2. The translation of any Tax Return, data, information, records, documents or other books
> into Arabic must be approved in accordance with the law regulating translation in the State, and submitted to the Authority
> within the period it specifies."

Penalty hook: the TPL lists as a violation "failing to submit the data, records and documents related to Tax in Arabic to the
Authority when requested" (TPL Art. 24 "Administrative Penalties Assessment", item (b); penalty amounts are in Cabinet
Decision 40 of 2017 as amended, not fetched). The e-invoicing framework "is designed to support both the Arabic and English languages" (EI-GL §5.1 note).

**For the pack:** `language: { invoice: 'any', records_on_request: 'ar', english_accepted: true }` — an English invoice is
lawful; an Arabic translation may be demanded later, at the taxpayer's cost.

## 7. Tax credit note

| Rule | Quoted | Source |
|---|---|---|
| When | "The Registrant shall issue an original Tax Credit Note when a reduction of Output Tax occurs in relation to any supply made by him according to Clause 2 of Article 62 of this Decree-Law and deliver the same to the Recipient". Definition: "A written or electronic document in which any amendment to reduce or cancel a Taxable Supply and its details are recorded, including an Electronic Credit Note". | DL Art. 70(1); DL Art. 1 |
| Particulars (ER Art. 60(1)) | a. The words "Tax Credit Note" clearly displayed on the invoice. b. The name, address, and Tax Registration Number of the Registrant making the supply. c. The name, address, and Tax Registration Number of the Recipient where he is a Registrant. d. The date of issuing the Tax Credit Note. e. The value of the supply shown on the Tax Invoice, the correct amount of the value of the supply, the difference between those two amounts, and the Tax charged that relates to that difference in AED. "In case more than one Tax Credit Note is issued in relation to the same Tax Invoice, the value of the supply shown on the Tax Invoice in the subsequent Tax Credit Note shall be the adjusted value based on the previous Tax Credit Note." f. A brief explanation of the circumstances giving rise to the issuing of the Tax Credit Note. g. Information sufficient to identify the supply to which the Tax Credit Note relates. | ER Art. 60(1) (as amended by CD 100 of 2024) |
| Buyer-created | Conditions as for invoices; "The words 'Tax Credit Note created by buyer' are clearly displayed". | ER Art. 60(4) |
| Electronic | Same two conditions as Art. 59(8). | ER Art. 60(3) |
| E-credit-note triggers | cancellation; consideration reduced; consideration returned in full or part; "an administrative or numerical error". | MD243 Art. 6(2) |

Note: there is **no "tax debit note"** in the UAE law; an under-charge is corrected by a further tax invoice (not found as an
explicit rule in an official source; it is the absence of any debit-note article in DL/ER).

## 8. Reverse charge and designated zones

| Rule | Quoted / listed | Source |
|---|---|---|
| Imports | "If the Taxable Person imports Concerned Goods or Concerned Services for the purposes of his Business, then he shall be treated as making a Taxable Supply to himself, and shall be responsible for all applicable Tax obligations and accounting for Due Tax in respect of these supplies." Conditions for goods (registered at import, customs registration number linked, etc.) in ER Art. 48(1); otherwise tax is paid at import under ER Art. 50. | DL Art. 48(1); ER Arts. 48, 50 |
| Goods in transit to another Implementing State | Exception in DL Art. 48(2): the importer pays the import tax under the ER mechanism. | DL Art. 48(2) |
| Hydrocarbons between registrants | Crude or refined oil, unprocessed or processed natural gas, or Pure Hydrocarbons supplied by a registrant to a registrant who will resell them or use them to produce or distribute energy: "The Registrant making the Supply shall not account for Tax" and "The Recipient of the Goods shall calculate the Tax". Needs the recipient's written declaration and TRN verification before the date of supply (Art. 48(4)). | DL Art. 48(3)–(6) |
| Cabinet may add categories | "The Cabinet may issue a decision specifying other Goods or Services that are subject to the reverse charge" | DL Art. 48(8) (later Cabinet decisions under this clause were not fetched this round) |
| Invoice wording | the full invoice must carry "a statement that the Recipient is required to account for Tax, and a reference to the relevant provision"; a simplified invoice may not be used. | ER Art. 59(1)(l), 59(5) |
| Return boxes | Output side Box 3 (services from abroad, goods not declared to customs, local oil-and-gas RCM) and Box 6/7 (customs-declared imports); recovery in Box 10. | RET Boxes 3, 6, 7, 10 |
| Designated Zone, definition | "A 'Designated Zone' that meets the conditions specified in the Executive Regulation of this Decree-Law shall be treated as being outside the State." Conditions: fenced area with security and customs controls; internal procedures for goods; operator complies with FTA procedures. Goods may move between Designated Zones without tax (DL Art. 51). | DL Arts. 50–52; ER Art. 51 |
| Designated Zones, named (FTA list) | **Abu Dhabi:** Free Trade Zone of Khalifa Port; Abu Dhabi Airport Free Zone; Khalifa Industrial Zone; Al Ain International Airport Free Zone; Al Butain International Airport Free Zone. **Dubai:** Jebel Ali Free Zone (North-South); Dubai Cars and Automotive Zone (DUCAMZ); Dubai Textile City; Free Zone Area in Al Quoz; Free Zone Area in Al Qusais; Dubai Aviation City; Dubai Airport Free Zone; International Humanitarian City – Jebel Ali. **Sharjah:** Hamriyah Free Zone; Sharjah Airport International Free Zone. **Ajman:** Ajman Free Zone. **Umm Al Quwain:** Umm Al Quwain Free Trade Zone in Ahmed Bin Rashid Port; Umm Al Quwain Free Trade Zone on Sheikh Mohammed Bin Zayed Road. **Ras Al Khaimah:** RAK Free Trade Zone; RAK Maritime City Free Zone; RAK Airport Free Zone. **Fujairah:** Fujairah Free Zone; FOIZ (Fujairah Oil Industry Zone). (23 names in this list; an FTA news item of 30 Oct 2021 says "A full list of all 27 Designated Zones" — the four later additions were not found in a fetched official document, so AE1 should treat the list as data loaded from the FTA page, not a constant.) | DZ (Cabinet Decision 59 of 2017 + 35 of 2018); FTA news https://tax.gov.ae/en/media.centre/news/amendment.on.tax.treatment.for.supply.f.goods.in.designated.zones.and.connected.shipping.aspx |
| E-invoice flag | PINT-AE "Invoice transaction type code" has a "Free Trade zone" flag (1/0) among its 8 flags. | EI-MF field 5 |

## 9. VAT201 return — the boxes and what each reads

Columns per box: **Amount (AED)** (net of VAT), **VAT Amount (AED)**, **Adjustment (AED)** (RET §3.2; RET-UM step "Enter
Amount, VAT Amount and adjustments for all the boxes below"). All amounts "in United Arab Emirates Dirhams (AED)", "to the
nearest fils", "Use '0' where necessary" (RET §3.2).

| Box | Label (as in RET) | What it reads | Source |
|---|---|---|---|
| 1 (1a–1g) | Standard rated supplies | Net value and 5% VAT of standard-rated supplies, **split by Emirate**: "This information should be identified by the Emirate in which that supply was made. For businesses with fixed establishments in the UAE, the supply should be reported in the Emirate where the fixed establishment most closely connected to the supply is located. For non-established businesses, the supply should be reported in the Emirate where the supply was received." RET-UM: "Enter the values for the standard rates supplies in the correct corresponding Emirate box." Includes credit-note reductions and corrections ≤ AED 10,000 (larger errors need a voluntary disclosure). Adjustments column: bad-debt relief claims and sales of taxable commercial property where the buyer paid the tax. The seven Emirate rows appear only as a form screenshot in RET-UM (the letters 1a–1g and Emirate names are **not found as text in an official source**); ER Art. 72(2)–(3) is the record rule behind the split. | RET Box 1; RET-UM p.19–20; ER Art. 72 |
| 2 | Tax Refunds provided to Tourists under the Tax Refunds for Tourists Scheme | Pre-populated (Planet Tax Free), negative, not editable; nil for non-participants. | RET Box 2; RET-UM |
| 3 | Supplies subject to the reverse charge provisions | Net and VAT of **received** supplies under RCM: services from foreign suppliers (standard and zero), goods not declared to customs, local RCM (oil and gas). Excludes customs-declared imports (Box 6). | RET Box 3 |
| 4 | Zero-rated supplies | Net only. | RET Box 4 |
| 5 | Exempt supplies | Net only. | RET Box 5 |
| 6 | Goods imported into the UAE | Auto-populated from customs declarations linked to the TRN; value includes customs duty and excise; VAT auto = 5%. | RET Box 6 |
| 7 | Adjustments to goods imported into the UAE | Manual +/- correction of Box 6 (missing or wrong declarations, zero-rated or exempt imports). | RET Box 7 |
| 8 | Totals | Sum of Boxes 1–7 (total output tax and adjustments). | RET Box 8 |
| 9 | Standard rated expenses | Net of expenses on which input tax is claimed; "Recoverable VAT Amount (AED)" = only the recoverable part; adjustments: unpaid-supplier (6 months) claw-back, annual input-tax apportionment wash-up, capital assets scheme. | RET Box 9 |
| 10 | Supplies subject to the reverse charge provisions | Recovery of the RCM output tax declared in Boxes 3, 6, 7, to the extent recoverable. | RET Box 10 |
| 11 | Totals | Box 9 + Box 10. | RET Box 11 |
| 12 | Total value of due tax for the period | Sum of VAT and Adjustments columns of the outputs section. | RET Box 12 |
| 13 | Total value of recoverable tax for the period | Sum of VAT and Adjustments columns of the inputs section. | RET Box 13 |
| 14 | Payable tax for the period | Box 12 − Box 13 (positive = pay; negative = refundable or carried forward). | RET Box 14 |
| 15 | Do you wish to request a refund for the above amount of excess recoverable tax | Yes → Form VAT311; No → carried forward. | RET Box 15 |
| — | Profit Margin Scheme | Yes/No: "Select 'Yes' if you have reported amounts using the 'Profit Margin Scheme'" in this period. | RET §Profit Margin Scheme; RET-UM |

## 10. Record retention

| Rule | Quoted | Source |
|---|---|---|
| What to keep | supplies and imports; invoices and credit notes received and issued; goods used for non-business purposes; purchases without input-tax deduction; exports; adjustments; Art. 48(3) hydrocarbon supplies with declarations; and a "Tax Record" of due tax, RCM due tax, corrections, recoverable tax. | DL Art. 78(1)(a)–(k) |
| How long — VAT | "any records required to be kept … must comply with timeframes … as specified in the Tax Procedures Law and its Executive Regulation." | ER Art. 71(1) |
| Standard period | "(5) five years following the Tax Period to which they relate in respect of a Taxable Person"; "(5) five years from the end of the calendar year in which the concerned document was created in respect of all Persons other than Taxable Persons"; "(7) seven years from the end of the calendar year in which the concerned document was created for real estate records." | TPL-ER Art. 3(1)(a)–(c) |
| Extensions | +4 years (or until settled) in a dispute; +4 years under audit; +4 years if an audit is notified before expiry; +1 year after a voluntary disclosure made in the 5th year; legal representative +1 year. | TPL-ER Art. 3(2)(3) |
| Real estate under VAT | "Any records related to a real estate required to be kept shall be held for a period of 15 (fifteen) years after the end of the Tax Period to which they relate." (The VAT ER says 15; the TPL-ER says 7 for "real estate records" — the longer VAT-specific rule governs VAT records.) | ER Art. 71(2) |
| Emirate evidence | Records "to prove the Emirate in which the Fixed Establishment related to this supply is located"; e-commerce suppliers above AED 100,000,000 a year must prove the Emirate where the supply is received. | ER Art. 72(2)–(6) |
| E-invoices | "store all Electronic Invoices, Electronic Credit Notes, and any associated data within the State in accordance with the timeline prescribed under the Tax Procedures Law." | MD243 Art. 11 |
| Corporate tax records | FTA Corporate Tax guides state a 7-year retention for records supporting a tax position (seen only in search snippets of the "Registration of Juridical Persons" guide; the CT law article was not read this round). | https://tax.gov.ae/Datafolder/Files/Guides/CT/R%20CT%20Registration%20of%20Juridical%20Persons%20-%20EN%20-%2031%2008%202023%20final.pdf |

## 11. Corporate Tax — what a chart of accounts needs

| Item | Quoted | Source |
|---|---|---|
| Law and start | Federal Decree-Law No. 47 of 2022 (amended by 60/2023, 40/2024, 28/2025). "The Federal Decree-Law applies to financial years beginning on or after 1 June 2023." | CTL header; MoF CT page https://mof.gov.ae/en/public-finance/tax/corporate-tax-in-the-uae/ |
| Rates | "a. 0% (zero percent) on the portion of the Taxable Income not exceeding the amount specified in a decision issued by the Cabinet … b. 9% (nine percent) on Taxable Income that exceeds the amount". The amount: "the portion of a Taxable Person's Taxable Income not exceeding 375,000 (three hundred seventy-five thousand dirhams) shall be subject to a 0% (0 percent) Corporate Tax rate"; above it "9% (nine percent)". | CTL Art. 3(1); CD116 Arts. 2–3 |
| Qualifying Free Zone Person | "0% (zero percent) on Qualifying Income" and 9% on non-qualifying income (no AED 375,000 band). | CTL Art. 3(2) |
| Top-up tax (DMTT) | CTL Art. 3(3): a Cabinet decision imposes a top-up tax "so that the total percentage of the effective tax rate imposed on them is (15%) fifteen percent." CD142 (issued 31 Dec 2024, effective 1 Jan 2025): applies to "Constituent Entities that are members of an MNE Group that has annual revenue of EUR 750 million or more in the Consolidated Financial Statements of the Ultimate Parent Entity in at least two of the four Fiscal Years immediately preceding"; "Minimum Rate: means fifteen percent (15%)." | CTL Art. 3(3); CD142 Art. 1.1.1 and definitions; MoF top-up page https://mof.gov.ae/en/public-finance/tax/top-up-tax/ |
| Small Business Relief | Revenue threshold "AED 3,000,000 (three million dirhams) for each Tax Period", for tax periods starting on or after 1 June 2023 and ending on or before 31 December 2026 (MD73 Art. 2). MoF announced on 7 Aug 2026 that Ministerial Decision No. 131 extends it to "tax periods ending on or before 31 December 2029" (decision text not fetched). | MD73 Art. 2; https://mof.gov.ae/en/news/ministry-of-finance-announces-extension-of-small-business-relief-for-corporate-tax-purposes-until-31-december-2029/ |
| Return and payment | "file a Tax Return … no later than (9) nine months from the end of the relevant Tax Period"; "settle the Corporate Tax Payable … within (9) nine months from the end of the relevant Tax Period". | CTL Arts. 53(1), 48 |
| Registration | "All Taxable Persons (including Free Zone Persons) will be required to register for Corporate Tax and obtain a Corporate Tax Registration Number." TIN = first 10 digits of the CT TRN. | MoF CT page; EI-MF §2 |
| Natural persons | Subject to CT only where UAE business turnover exceeds AED 1 million in a calendar year (seen in FTA guide search snippet; article not read). | FTA "Taxation of natural persons" guide https://tax.gov.ae/Datafolder/Files/Guides/CT/Taxation%20of%20natural%20persons%20-%2025%2011%202023.pdf |

**Chart slots implied:** a Corporate Tax payable liability, a Corporate Tax expense, an optional Top-up Tax payable (MNEs
only), and a flag for Small Business Relief election (no tax computed). No withholding tax on domestic payments is in the CTL
rate article (0% withholding exists in the law but was not read this round).

## 12. E-invoicing mandate — what is decided, with dates

| Fact | Quoted / decided | Source |
|---|---|---|
| Enabling law | Federal Decree-Law No. 17 of 2024 (Tax Procedures) "introduces a definition for the 'eInvoicing system' and grants the Minister of Finance the authority to issue the necessary decisions"; Federal Decree-Law No. 16 of 2024 (VAT) expands "tax invoice" and "tax credit note" to include electronic ones. Both effective 30 Oct 2024. TPL Art. 4(bis): "Any Person determined by the Minister, shall be subject to the Electronic Invoicing System." | MoF news 29 Oct 2024 https://mof.gov.ae/en/news/issuance-of-amendments-to-federal-decree-law-on-tax-procedures-and-federal-decree-law-on-value-added-tax-to-support-the-einvoicing-system/; DL header; TPL Art. 4(bis) |
| Model | "5 Corner model … Corner 1: Supplier · Corner 2: Supplier's ASP · Corner 3: Recipient's (buyer's) ASP · Corner 4: Recipient (buyer) · Corner 5: Federal Tax Authority." Decentralised Continuous Transaction Control and Exchange (DCTCE); format PINT-AE (Peppol); Tax Data Document reported to the FTA. | EI-GL §3; MoF e-invoicing page https://mof.gov.ae/en/about-us/initiatives/einvoicing/ |
| Scope | "Any Person conducting Business in the State in respect of every Business Transaction" unless excluded (MD243 Art. 3). "Electronic Invoicing is mandatory for any Person conducting Business in the UAE, regardless of their VAT registration status" (EI-MF §2). In-scope matrix: B2B, B2G, G2B, G2G; **not** B2C, C2B, C2G, G2C, C2C. | MD243 Art. 3; EI-MF §2; EI-GL §6.2 |
| B2C | "Business-to-Consumer Transactions shall not be subject to the Electronic Invoicing System and any Person engaged exclusively in such transactions shall not be subject to the Electronic Invoicing System, until such time determined by a decision issued by the Minister." | MD244 Art. 5(2) |
| Excluded transactions | sovereign government transactions; airline passenger tickets (Electronic Ticket) and ancillary services (EMD); airline cargo under an Airway Bill (24 months only); "Financial services that are exempt from VAT or subject to VAT at the zero rate, in accordance with Article 42 of the VAT Executive Regulation"; others the Minister decides. | MD243 Art. 4(1) |
| Pilot | "The Pilot Programme shall commence on 1 July 2026." | MD244 Art. 3(4) |
| Voluntary | "Any Person may implement the Electronic Invoicing System on a voluntary basis as from 1 July 2026" | MD244 Art. 4 |
| Phase 1 (Revenue ≥ AED 50,000,000) | Appoint an Accredited Service Provider **by 30 October 2026** (MD66 replaced the original 31 July 2026) "and shall implement the Electronic Invoicing System by 1 January 2027." | MD244 Art. 5(1)(a) as amended by MD66 Art. One; MoF news 10 May 2026 https://mof.gov.ae/en/news/ministry-of-finance-announces-targeted-amendments-to-einvoicing-system-decisions/ |
| Phase 2 (Revenue < AED 50,000,000) | "shall appoint an Accredited Service Provider by 31 March 2027 and shall implement the Electronic Invoicing System by 1 July 2027." | MD244 Art. 5(1)(b) |
| Government entities | ASP by 31 March 2027, implement by 1 October 2027. | MD244 Art. 5(1)(c) |
| Revenue definition | "The gross income earned by a Person during the most recent Accounting Period, based on the financial statements". | MD244 Art. 1 |
| Issue and transmit window | Registrants: within the VAT-law timeline (14 days, DL Art. 67). Others: "within 14 days from the Date of Business Transaction" (the earlier of the transaction date or receipt of payment). Reporting to the FTA "within the timeline prescribed by the Minister" (not yet fixed in a fetched document). | MD243 Art. 6(4)(5)(6) |
| System failure | notify the FTA "within 2 Business Days". ASP data-change notice: 5 Business Days. | MD243 Arts. 12, 5(3) |
| Penalties | CD106 table: failure to implement / appoint an ASP on time: AED 5,000 per month or part; failure to issue an e-invoice or e-credit note on time: AED 100 each, max AED 5,000 per calendar month; failure to notify system failure, or ASP of data changes: AED 1,000 per day. Not applied to voluntary adopters (Art. 2(2)). "Any administrative penalties shall only be applicable from the date that Person is required to mandatorily implement". | CD106 Arts. 2–3 and annex; EI-GL §8.2 |
| Mandatory fields (electronic tax invoice) | 51 fields in EI-MF §4.1: invoice number, date, type code, currency code, transaction-type flags (Free Trade zone · Deemed Supply · Margin Scheme · Summary Invoice · Continuous Supply · Disclosed Agent Billing · Supply through e-commerce · Exports), payment due date, business process type, specification identifier (`urn:peppol:pint:billing-1@ae-1`), payment means; seller name, electronic address (TIN) and identifier (0235), legal registration id and type (TL / EID / PAS / CD), TRN, tax scheme VAT, address, city, subdivision, country AE; buyer name, electronic address/identifier, TRN, scheme, address, city, subdivision, country; totals (line net sum, total without tax, total tax, total with tax, amount due); tax breakdown (taxable amount, tax amount, category code, rate); per line: id, quantity, unit code, line net, item net price, gross price, base quantity, tax category code, tax rate, **VAT line amount in AED**, **invoice line amount in AED**, item name, description. | EI-MF §4.1 |
| Other instruments | MD 64 of 2025 (ASP accreditation) amended by MD 56 of 2026; MoF page also lists MD 168 of 2026 (replacement accreditation decision). FTA: "The only official source of information related to the introduction of e-Invoicing in the UAE is the Ministry of Finance portal." | MoF e-invoicing page; FTA e-invoicing page https://tax.gov.ae/en/taxes/Vat/uae.einvoicing.aspx |

## 13. Region — Oman, Bahrain, Saudi Arabia, Qatar, Kuwait

**Oman (VAT 5%, live).** Royal Decree No. 121/2020 (issued 12 October 2020, in force 180 days after Gazette publication):
"the Tax on the import and supply of taxable Goods or Services shall be computed as (5%) five percent of the Taxable Value"
(Art. 36). The Tax Authority's rate page: "Basic rate: 5% applied on most goods and services", zero rate for exports,
"Essential goods (513 items)" and international transport, exemptions for financial services and residential rent. Thresholds
are set by the Chairman's Decision under the law: "The Mandatory Registration Threshold under Article (55) of the VAT Law is
(38,500) thirty-eight thousand and five hundred Omani Rials" and "The Voluntary Registration Threshold under Article (61) of
the VAT Law is (19,250)". Tax period: "the VAT return filing period – quarterly"; payment "by the same date the tax return is
due". Sources: law https://tms.taxoman.gov.om/portal/documents/20126/1414820/VAT+Law+.pdf/9cbe8926-066b-d48d-2b7f-14f41b4c19a8?t=1733169733344 ·
rate page https://tms.taxoman.gov.om/portal/tax-rate · thresholds decision
https://tms.taxoman.gov.om/portal/documents/20126/1414820/Determining+the+Mandatory+and+Voluntary+Registration+Thresholds.pdf/4c5d8dcb-5b81-34ae-a1d2-e3c6d8431988?t=1733169610184 ·
return guide https://tms.taxoman.gov.om/portal/documents/20126/1414820/VAT+Taxpayer+Guide+-+VAT+Return+Filing.pdf/fae31d0c-e7e7-0014-9f28-a4c506b36614?t=1733169613409.
(The exact go-live date, 16 April 2021, was not found as text in a fetched official page; it follows from the 180-day rule.)

**Bahrain (VAT 10%, live).** National Bureau for Revenue (NBR): "تم تغيير النسبة الأساسية للقيمة المضافة من 5% إلى 10% اعتبارًا من 1 يناير 2022"
("the basic VAT rate was changed from 5% to 10% effective 1 January 2022"); VAT law is Decree-Law No. 48 of 2018. Thresholds:
mandatory "37,500 دينار بحريني" of annual taxable supplies, voluntary "18,750 دينار بحريني". Sources (Arabic; the site refuses
automated fetches, quotes are from the search index of nbr.gov.bh): https://www.nbr.gov.bh/vat_faqs/17 ·
https://www.nbr.gov.bh/VAT/what_is_vat · https://www.nbr.gov.bh/vat_registration · https://www.nbr.gov.bh/laws_regulations/vat.

**Saudi Arabia (VAT 15%, live; e-invoicing phase 2 in waves).** ZATCA news, Riyadh 1 July 2020: "دخل اليوم الأربعاء الموافق الأول من يوليو 2020 قرار رفع نسبة ضريبة القيمة المضافة إلى 15% حيز التنفيذ"
(the 15% rate took effect 1 July 2020, by Royal Order A/638 amending Article 2 of the VAT Law) —
https://zatca.gov.sa/en/MediaCenter/News/Pages/News-342.aspx. E-invoicing (Fatoora): "Phase 1 is enforceable as of December
4th, 2021, for all taxpayers" (generation); "Phase 2, known as the Integration phase and rolled-out in waves by targeted
taxpayer group" from 1 January 2023; "ZATCA will notify taxpayers of their Phase 2 wave at least six months in advance" —
https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx. Latest waves: Wave 24, VAT-subject revenue above
SAR 375,000 in 2022/2023/2024, integrate by 30 June 2026 (https://zatca.gov.sa/en/Pages/news_1426.aspx); **Wave 25**, revenue
"exceeded (SAR 187,500) during 2022, 2023, 2024 or 2025", integrate "no later than February 1, 2027" (news dated 24 July 2026,
https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx). Phase 2 mechanics: standard tax invoices are
**cleared** by ZATCA before sharing; simplified invoices are **reported** "within a period which must not exceed (24) hours
from its generation"; XML with cryptographic stamp and QR — ZATCA E-Invoicing Resolution
https://zatca.gov.sa/en/E-Invoicing/Introduction/LawsAndRegulations/Documents/20210602_ZATCA_Electronic_Invoice_Resolution_English_Vshared.pdf.

**Qatar (no VAT).** General Tax Authority investors' guide: "Qatar has not applied the Value Added Tax (VAT)." The taxes
listed are Income Tax, Withholding Tax, Capital Gains Tax, Excise Tax (plus Pillar Two under Law No. 22 of 2024) —
https://gta.gov.qa/en/investors-guide. No VAT law or start date is published on gta.gov.qa.

**Kuwait (no VAT).** No VAT law or rate is published by the Ministry of Finance; its tax pages cover the multinational
minimum top-up tax: "سيدخل القانون الجديد حيز التنفيذ اعتبارًا من الأول من يناير 2025 … التي تتجاوز إيراداتها العالمية السنوية 750 مليون يورو … الحد الأدنى من الضريبة البالغ 15%"
(15% DMTT from 1 January 2025 on groups above EUR 750 million) — https://www.mof.gov.kw/MOFServices/TaxMultinationalDefinition.aspx.
The state news agency KUNA quotes the IMF mission (Dec 2025) that a "5 percent VAT (Value Added Tax) should be introduced",
i.e. it has not been — https://www.kuna.net.kw/ArticleDetails.aspx?id=3266549&language=en (KUNA is official state media, not
a tax authority; the Kuwait e-government news page was unreachable from this runner).

## 14. What was NOT found in an official source (round AE1 must not invent these)

- A TRN **check digit** or fixed prefix. Validate 15 digits only.
- The **Emirate sub-box letters** (1a–1g) and their order as text; they exist only in a form screenshot.
- The **go-live date of Oman VAT** as a sentence (derived from the 180-day rule).
- The **four additional Designated Zones** that take the FTA's count from 23 to 27.
- The reporting-to-FTA window for e-invoices ("within the timeline prescribed by the Minister", MD243 Art. 6(6), not yet fixed in any fetched decision).
- Cabinet decisions adding reverse-charge categories under DL Art. 48(8) (e.g. electronic devices) — not fetched; AE1 should carry `rcm.categories` as data with a `cite` per row, as the IN pack does.
- Administrative penalty amounts for VAT (Cabinet Decision 40 of 2017 as amended) — not fetched.

## 15. Pack checklist — member → value → source (for `reg-ae.js`, same shape as `tax-packs.js` IN)

The member names follow `chitbridge-api/lib/tax-packs.js` (adopted from chitbridge-engines `src/tax-packs.js`): `country ·
scheme · supply · rates · invoice_round_to · rcm · einvoice · source`, widened additively with the UAE-only members. Money in
**fils** (`*_minor`) as the IN pack keeps paise.

| Member | Value | Source |
|---|---|---|
| `country` | `'AE'` | ISO 3166-1 |
| `scheme` | `'VAT'` | DL title |
| `supply` | `'border'` (domestic → full rate on one head; cross-border → recipient accounts, DL Art. 48(1); supply to an Implementing State → document not labelled Tax Invoice, no tax, DL Art. 66) | DL Arts. 48, 66 |
| `currency` | `'AED'`; minor unit fils, 100 per dirham | DL Art. 69; RET §3.2 |
| `rates` | `[0, 5]` | DL Arts. 3, 45 |
| `invoice_round_to` | `0.01` | ER Art. 61; RET §3.2 |
| `line_tax_rounding` | `'half_up_to_fils'` per supply, permitted not required | ER Art. 61 |
| `fx_source` | `'UAE Central Bank rate at the date of supply'`; rate must be printed on the invoice | DL Art. 69; ER Art. 59(1)(k) |
| `trn` | `{ digits: 15, tin_digits: 10, check: null, peppol_scheme: '0235' }` | EI-MF glossary 11–12, field 12 |
| `registration` | `{ mandatory_minor: 375000*100, voluntary_minor: 187500*100, lookback_months: 12, lookahead_days: 30, apply_within_days: 30, non_resident_threshold: null }` | ER Arts. 7(1)(2), 8(1); DL Arts. 13, 17 |
| `tax_period` | `{ standard_months: 3, assigned_by: 'FTA', staggers: ['Jan-end', 'Feb-end', 'Mar-end', 'monthly'], due_day: 28, next_business_day: true, nil_return: true }` | ER Arts. 62, 64; RET §2.1 |
| `invoice.full.fields` | the 12 particulars a–l of §6.2 | ER Art. 59(1) |
| `invoice.full.title` | `'Tax Invoice'` (exact words) | ER Art. 59(1)(a) |
| `invoice.simplified.fields` | the 5 particulars a–e of §6.3 | ER Art. 59(2) |
| `invoice.simplified.allowed_when` | recipient not a registrant, OR consideration ≤ AED 10,000 (`10000*100` fils); never under reverse charge | ER Art. 59(5) |
| `invoice.simplified.issue` | `'on the date of supply'` | ER Art. 59(13)(1) |
| `invoice.issue_within_days` | `14` from the date of supply; summary invoice 14 days from month end | DL Art. 67; ER Art. 59(13) |
| `invoice.summary_allowed` | `true` (one summary invoice for several supplies to one recipient) | ER Art. 59(6) |
| `invoice.self_billing_words` | `'Tax Invoice raised by buyer'` | ER Art. 59(9)(d) |
| `invoice.rcm_statement` | required: "a statement that the Recipient is required to account for Tax, and a reference to the relevant provision of the Decree-Law" (DL Art. 48) | ER Art. 59(1)(l) |
| `invoice.language` | `{ document: 'any', records_on_request: 'ar', english_accepted: true, translation_cost: 'taxpayer' }` | TPL Art. 5; TPL-ER Art. 5 |
| `credit_note.title` | `'Tax Credit Note'`; buyer-created: `'Tax Credit Note created by buyer'` | ER Art. 60(1)(a), 60(4)(d) |
| `credit_note.fields` | the 7 particulars a–g of §7, incl. original value · corrected value · difference · tax on the difference, chained for a second note | ER Art. 60(1) |
| `debit_note` | none in law | absence in DL/ER |
| `rcm.source` | `'DL Art. 48; ER Arts. 48, 50'` | — |
| `rcm.categories` | `import_goods` (DL 48(1), ER 48(1) conditions; else pay at import ER 50) · `import_services` (DL 48(1)) · `hydrocarbons_b2b` (DL 48(3)–(6), written declaration + TRN check) · further rows only with a Cabinet-decision cite (DL 48(8)) | DL Art. 48 |
| `designated_zones` | the 23 names in §8 as data, with `cite: 'Cabinet Decision 59 of 2017 as amended by 35 of 2018 (FTA list)'`; a `count_note: 'FTA news 30 Oct 2021 says 27'` | DZ; FTA news |
| `return.form` | `'VAT201'`; columns `['amount', 'vat', 'adjustment']`; boxes 1(1a–1g by Emirate), 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, `profit_margin_flag` — mapping in §9 | RET; RET-UM |
| `return.emirates` | `['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah']` (order as the DZ list groups them; letters 1a–1g not found as text) | DZ headings; RET Box 1 |
| `records.years` | `{ standard: 5, real_estate_vat: 15, real_estate_tpl: 7, dispute_extra: 4, audit_extra: 4, voluntary_disclosure_extra: 1 }` | TPL-ER Art. 3; ER Art. 71(2) |
| `records.emirate_evidence` | required per supply; e-commerce ≥ AED 100,000,000 → Emirate of receipt | ER Art. 72 |
| `einvoice.model` | `'5-corner DCTCE, Peppol PINT-AE'`; spec id `'urn:peppol:pint:billing-1@ae-1'`; participant `'0235' + TIN` | EI-GL §3; Appendix |
| `einvoice.scope` | B2B, B2G, G2B, G2G; `b2c: false` (MD244 Art. 5(2)); excluded: sovereign, airline tickets/EMD/airway bill (24 mo), VAT-exempt or zero-rated financial services | MD243 Arts. 3–4; MD244 Art. 5(2) |
| `einvoice.phases` | `[{ from: '2026-07-01', kind: 'pilot_and_voluntary' }, { revenue_at_least_minor: 50e6*100, asp_by: '2026-10-30', live: '2027-01-01', cite: 'MD244 Art. 5(1)(a) as amended by MD66' }, { revenue_below_minor: 50e6*100, asp_by: '2027-03-31', live: '2027-07-01', cite: 'MD244 Art. 5(1)(b)' }, { kind: 'government', asp_by: '2027-03-31', live: '2027-10-01', cite: 'MD244 Art. 5(1)(c)' }]` | MD244; MD66 |
| `einvoice.issue_within_days` | `14` from the Date of Business Transaction (earlier of transaction or payment) | MD243 Art. 6(5), Art. 1 |
| `einvoice.doc_types` | invoice, credit note (no debit note) | MD243 Art. 6 |
| `einvoice.transaction_flags` | `['free_trade_zone', 'deemed_supply', 'margin_scheme', 'summary_invoice', 'continuous_supply', 'disclosed_agent_billing', 'ecommerce', 'exports']` | EI-MF field 5 |
| `einvoice.mandatory_fields` | the 51 fields of EI-MF §4.1 | EI-MF |
| `einvoice.penalties` | per CD106 table (§12) | CD106 |
| `corporate_tax` | `{ law: 'FDL 47 of 2022', from: 'FY starting on/after 2023-06-01', bands: [{ upto_minor: 375000*100, rate: 0 }, { above_minor: 375000*100, rate: 9 }], qfzp: { qualifying: 0, other: 9 }, small_business_relief: { revenue_upto_minor: 3e6*100, periods_ending_by: '2026-12-31', extension_announced: '2029-12-31 (MD 131, MoF 7 Aug 2026)' }, dmtt: { rate: 15, from: '2025-01-01', group_revenue_eur: 750e6 }, return_months: 9, pay_months: 9 }` | CTL Arts. 3, 48, 53; CD116; MD73; CD142 |
| `source` | `'Federal Decree-Law No. 8 of 2017 (as amended to FDL 16 of 2024); Cabinet Decision No. 52 of 2017 (as amended to CD 100 of 2024); FDL 28 of 2022 + CD 74 of 2023; FTA VAT Returns guide Aug 2021; MoF MD 243/244 of 2025, MD 66 of 2026, CD 106 of 2025; FDL 47 of 2022, CD 116 of 2022, MD 73 of 2023, CD 142 of 2024'` | this file |
