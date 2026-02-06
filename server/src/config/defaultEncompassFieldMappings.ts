/**
 * Default Encompass Field Mappings
 *
 * This file contains the default Coheus alias → Encompass field ID mappings.
 * These are used as the base mappings for all tenants. Tenants can override
 * individual mappings via the encompass_field_swaps table.
 *
 * Format: { [coheusAlias: string]: encompassFieldId }
 *
 * To add a new field:
 * 1. Add the mapping here
 * 2. Ensure the loans table has a corresponding column (via migration)
 * 3. Update the column name aliases in encompassFieldMapper.ts if needed
 */

export interface FieldMappingDefinition {
  fieldId: string;
  alias: string;
  description?: string;
  category?: FieldCategory;
}

// ============================================================================
// FIELD CATEGORIES
// ============================================================================

/**
 * Field category types matching the sections in DEFAULT_ENCOMPASS_FIELD_MAPPINGS
 */
export type FieldCategory =
  | "loan_info"
  | "property"
  | "borrower"
  | "pricing"
  | "investor"
  | "underwriting"
  | "dates"
  | "team"
  | "arm"
  | "payment_mi"
  | "heloc"
  | "compliance"
  | "fees";

/**
 * Category metadata with labels and descriptions for UI display
 */
export const FIELD_CATEGORIES: Record<
  FieldCategory,
  { label: string; description: string; order: number }
> = {
  loan_info: {
    label: "Loan Information",
    description: "Core loan details like amount, rate, term, and status",
    order: 1,
  },
  property: {
    label: "Property",
    description: "Property address, type, and characteristics",
    order: 2,
  },
  borrower: {
    label: "Borrower",
    description: "Borrower and co-borrower employment, income, and assets",
    order: 3,
  },
  pricing: {
    label: "Pricing & Rate Lock",
    description: "Lock details, margins, and price adjustments",
    order: 4,
  },
  investor: {
    label: "Investor & Servicing",
    description: "Investor info, servicing fees, and warehouse details",
    order: 5,
  },
  underwriting: {
    label: "Underwriting",
    description: "AUS decisions, risk scores, and conditions",
    order: 6,
  },
  dates: {
    label: "Key Dates",
    description: "Milestone dates, disclosures, and timeline events",
    order: 7,
  },
  team: {
    label: "Team Members",
    description: "Loan officers, processors, underwriters, and branch info",
    order: 8,
  },
  arm: {
    label: "ARM Fields",
    description: "Adjustable rate mortgage parameters and caps",
    order: 9,
  },
  payment_mi: {
    label: "Payment & MI",
    description: "Payment amounts and mortgage insurance details",
    order: 10,
  },
  heloc: {
    label: "HELOC",
    description: "Home equity line of credit specific fields",
    order: 11,
  },
  compliance: {
    label: "Compliance",
    description: "QM, ATR, HMDA, and Mavent compliance results",
    order: 12,
  },
  fees: {
    label: "Fees",
    description: "Origination, appraisal, credit report, and other fees",
    order: 13,
  },
};

/**
 * Map each Coheus alias to its category
 */
export const FIELD_CATEGORY_MAP: Record<string, FieldCategory> = {
  // LOAN INFORMATION
  "Loan Amount": "loan_info",
  "Interest Rate": "loan_info",
  "Loan Term": "loan_info",
  "Sales Price": "loan_info",
  "LTV Ratio": "loan_info",
  "Appraised Value": "loan_info",
  "Loan Number": "loan_info",
  "Lien Position": "loan_info",
  "Product Type": "loan_info",
  CLTV: "loan_info",
  "Loan Type": "loan_info",
  "Current Loan Status": "loan_info",
  "Loan Program": "loan_info",
  "Base Loan Amount": "loan_info",
  HCLTV: "loan_info",
  "Loan Purpose": "loan_info",
  Channel: "loan_info",
  "Loan Source": "loan_info",
  GUID: "loan_info",
  "Loan Folder": "loan_info",
  "Last Modified Date": "loan_info",
  "Current Milestone": "loan_info",

  // PROPERTY INFORMATION
  "Property Street": "property",
  "Property City": "property",
  "Property County": "property",
  "Property State": "property",
  "Property Zip": "property",
  "Number of Units": "property",
  "County FIPS Code": "property",
  "State FIPS Code": "property",
  "Property Rights": "property",
  "Property Type": "property",
  "Occupancy Type": "property",
  "Property Valuation Method Type": "property",
  "Property Valuation Effective Date": "property",
  "Total Mortgaged Properties Count": "property",

  // BORROWER INFORMATION
  "FICO Score": "borrower",
  "Income Total Mo Income": "borrower",
  "BE DTI Ratio": "borrower",
  "BORR EMPLOYER": "borrower",
  "Borr Position": "borrower",
  "Borr Position - 2nd": "borrower",
  "Borr Yrs on Job": "borrower",
  "Borr Yrs on Job - 2nd": "borrower",
  "Borr Self Employed": "borrower",
  "Borr Self Employed - 2nd": "borrower",
  "Co-Borr Employer": "borrower",
  "Co-Borr Position": "borrower",
  "Co-Borr Yrs on Job": "borrower",
  "Co-Borr Self Employed": "borrower",
  "Borrower Type": "borrower",
  "CoBorrower Type": "borrower",
  "Borrower Mailing Address is same as the Property Address": "borrower",
  "CoBorrower Mailing Address is same as the Property Address": "borrower",
  "Combined Assets All Borrowers": "borrower",
  "Assets Subtotal Liquid Assets": "borrower",

  // PRICING & RATE LOCK
  "Lock Days": "pricing",
  "Lock Date": "pricing",
  "Lock Expiration Date": "pricing",
  "Rate Lock Buy Side Net Buy Rate": "pricing",
  "Rate Lock Buy Side Base Price Rate": "pricing",
  "Net Buy": "pricing",
  "Net Sell": "pricing",
  "SRP from investor": "pricing",
  "Discount / Yield Spread Premium": "pricing",
  "Rate Lock Buy Side Adjusted Buy Price": "pricing",
  "Corporate Price Concession": "pricing",
  "Branch Price Concession": "pricing",
  "Buy Side Lock Date": "pricing",
  "Buy Side Lock # Days": "pricing",
  "Buy Side Lock Expiration": "pricing",
  "Sell Side Lock # Days": "pricing",
  "Sell Side Lock Expiration": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 1 Desc": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 1 Rate": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 2 Desc": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 2 Rate": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 3 Desc": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 3 Rate": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 4 Desc": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 4 Rate": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 5 Desc": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 5 Rate": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 6 Desc": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 6 Rate": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 7 Desc": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 7 Rate": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 8 Desc": "pricing",
  "Rate Lock Buy Side Profit Margin Adjustment 8 Rate": "pricing",

  // INVESTOR & SERVICING
  Investor: "investor",
  "Investor Status": "investor",
  "Investor Lock Date": "investor",
  "Investor Purchase Date": "investor",
  "Service Fee": "investor",
  "Guaranty Fee": "investor",
  "MSR Value": "investor",
  "Hedged Loan": "investor",
  "Warehouse Co Name": "investor",
  "PA Payout 1": "investor",
  "PA Payout 2": "investor",
  "PA Payout 3": "investor",
  "PA Payout 4": "investor",
  "PA Payout 5": "investor",
  "PA Payout 6": "investor",
  "PA Payout 7": "investor",
  "PA Payout 8": "investor",
  "PA Payout 9": "investor",
  "PA Payout 10": "investor",
  "PA Payout 11": "investor",
  "PA Payout 12": "investor",
  "PA Sell Amt": "investor",
  "PA SRP Amt": "investor",

  // UNDERWRITING
  "Underwriter Risk Assess Type": "underwriting",
  "Underwriter Risk Assess AUS Recomm": "underwriting",
  "Underwriting Description": "underwriting",
  "Underwriting AUS Source": "underwriting",
  "AU Decision Date": "underwriting",
  "Underwriting AUS Number": "underwriting",
  "DU/LP Case ID": "underwriting",
  "Fannie AU Decision": "underwriting",
  "Fannie Property Valuation Form Type": "underwriting",
  "Freddie AU Decision": "underwriting",
  "Freddie AVM Model Name Type Other Description": "underwriting",
  "Freddie Property Valuation Form Type": "underwriting",
  "Freddie Loan Level Credit Score Value": "underwriting",
  "Freddie Loan Level Credit Score Method": "underwriting",
  "Freddie Underwriting Type Other": "underwriting",
  "CU Risk Score": "underwriting",
  "Number Of Conditions": "underwriting",
  "UW Touches": "underwriting",

  // KEY DATES
  "Application Date": "dates",
  "Current Status Date": "dates",
  "Loan Estimate Sent Date": "dates",
  "Loan Estimate Received Date": "dates",
  "Revised LE Sent Date": "dates",
  "Revised LE Received Date": "dates",
  "Closing Disclosure Sent Date": "dates",
  "Closing Disclosure Received Date": "dates",
  "Revised CD Sent Date": "dates",
  "Revised CD Received Date": "dates",
  "Closing Date": "dates",
  "Estimated Closing Date": "dates",
  "Funds Sent Date": "dates",
  "Funding Date": "dates",
  "Shipped Date": "dates",
  "Appraisal Ordered Date": "dates",
  "Appraisal Completed Date": "dates",
  "Appraisal Received Date": "dates",
  "UW Suspended Date": "dates",
  "UW Denied Date": "dates",
  "Conditional Approval Date": "dates",
  "UW Final Approval Date": "dates",
  "CTC Date": "dates",
  "Credit Pull Date": "dates",
  "Loan First Payment Date": "dates",
  "Flood Certification Date": "dates",
  "Note Date": "dates",
  "Maturity Date": "dates",
  "Submitted To Processing Date": "dates",
  "Started Date": "dates",
  "Submitted To Underwriting Date": "dates",
  "PreApproval Req. Dt": "dates",

  // TEAM MEMBERS
  "Loan Officer": "team",
  "Loan Officer ID": "team",
  "Legacy Loan Officer ID": "team",
  "Loan Interviewer": "team",
  "Loan Processor ID": "team",
  "Underwriter ID": "team",
  "Closer ID": "team",
  "Account Executive": "team",
  Closer: "team",
  Processor: "team",
  Underwriter: "team",
  "Broker Lender Name": "team",
  Branch: "team",
  "Company NMLS ID": "team",
  "NMLS ID": "team",
  ORGID: "team",
  "Mers Min": "team",

  // ARM FIELDS
  "First Rate Adjustment Cap": "arm",
  "First Rate Adjustment Date": "arm",
  "Floor Rate": "arm",
  "Life Cap": "arm",
  Margin: "arm",
  "ARM Program": "arm",
  "Margin Index": "arm",
  Rounding: "arm",
  Lookback: "arm",
  "1st Change Months": "arm",
  "Maximum Rate Adjustment Cap": "arm",
  "Adjustment Period Months": "arm",
  "Description of the ARM index type": "arm",
  "Interest Only Payments": "arm",
  "Number of Months Interest Only Payments": "arm",
  "Balloon Payments": "arm",

  // PAYMENT & MI
  "P&I Payment": "payment_mi",
  "PITI Payment": "payment_mi",
  "PMI Flag": "payment_mi",
  "Mortgage Insurance Company Name": "payment_mi",
  "Private Mortgage Insurance Indicator": "payment_mi",
  "MI % Coverage 1": "payment_mi",
  "MI Coverage 1 Months": "payment_mi",
  "Mi % Coverage 2": "payment_mi",
  "MI Coverage 2 Months": "payment_mi",
  "MI Cancel %": "payment_mi",
  "Number of Months Reserves": "payment_mi",

  // HELOC
  "HELOC Intial Draw": "heloc",
  "HELOC Draw Period": "heloc",
  "HELOC Repayment Period": "heloc",

  // COMPLIANCE
  "Interest Only Indicator": "compliance",
  "Business or Commercial Purpose": "compliance",
  "Document Type": "compliance",
  "Frefinance Cash Out Type": "compliance",
  "Exempt from Reg. Z": "compliance",
  "ATR Loan Type": "compliance",
  "QM Loan Type": "compliance",
  "Safe Harbor": "compliance",
  "Meets Agency/GSE QM": "compliance",
  "CD Applied Cure": "compliance",
  "CD Lender Credits": "compliance",
  "Preapproval Flag": "compliance",
  "Mavent - GSE Result": "compliance",
  "Mavent - High-Cost result": "compliance",
  "Mavent - Enterprise Result": "compliance",
  "Mavent - ATR-QM Result": "compliance",
  "Mavent - TILA Tolerance Result": "compliance",
  "Mavent - NMLS Licensing Result": "compliance",
  "Mavent - State Rules Result": "compliance",
  "Mavent - HMDA Result": "compliance",
  "Mavent - HPML Result": "compliance",
  "Mavent - License Reviewer Result": "compliance",
  "Mavent - Other Result": "compliance",
  "Mavent - Overall Result": "compliance",

  // FEES
  "Orig Fees Seller": "fees",
  "Origination Points": "fees",
  "Orig Fee Borr Pd": "fees",
  "Fee Details - Line 804 - Borrower Amount - Appraisal Fee": "fees",
  "Fee Details - Line 804 - Seller Amount - Appraisal Fee": "fees",
  "Fee Details - Line 804 Appraisal Fee PAC": "fees",
  "Fee Details - Line 804 - Borrower POC Amount - Appraisal": "fees",
  "Fee Details - Line 804 - Seller POC Amount - Appraisal": "fees",
  "Fee Details - Line 804 - Broker POC Amount - Appraisal": "fees",
  "Fee Details - Line 804 - Lender POC Amount - Appraisal": "fees",
  "Fee Details - Line 804 - Other POC Amount - Appraisal": "fees",
  "Fee Details - Line 805 - Borrower Amount - Credit Report": "fees",
  "Fee Details - Line 805 - Seller Amount - Credit Report": "fees",
  "Fee Details - Line 805 Credit Report Fee PAC": "fees",
  "Fee Details - Line 805 - Borrower POC Amount - Cred Report": "fees",
  "Fee Details - Line 805 - Seller POC Amount - Cred Report": "fees",
  "Fee Details - Line 805 - Broker POC Amount - Cred Report": "fees",
  "Fee Details - Line 805 - Lender POC Amount - Cred Report": "fees",
  "Fee Details - Line 805 - Other POC Amount - Cred Report": "fees",
  "Fee Details - Line 807 - Borrower Amount - Flood Cert": "fees",
  "Fee Details - Line 807 - Seller Amount - Flood Cert": "fees",
  "Fee Details - Line 807 Flood Certification Fee PAC": "fees",
  "Fee Details - Line 807 - Borrower POC Amount - Flood Cert": "fees",
  "Fee Details - Line 807 - Seller POC Amount - Flood Cert": "fees",
  "Fee Details - Line 807 - Broker POC Amount - Flood Cert": "fees",
  "Fee Details - Line 807 - Lender POC Amount - Flood Cert": "fees",
  "Fee Details - Line 807 - Other POC Amount - Flood Cert": "fees",
};

/**
 * Default Encompass field mappings
 * Key: Coheus alias (used in UI and reporting)
 * Value: Encompass field ID (used in API calls)
 */
export const DEFAULT_ENCOMPASS_FIELD_MAPPINGS: Record<string, string> = {
  // ============================================================================
  // LOAN INFORMATION
  // ============================================================================
  "Loan Amount": "Fields.2",
  "Interest Rate": "Fields.3",
  "Loan Term": "Fields.4",
  "Sales Price": "Fields.136",
  "LTV Ratio": "Fields.353",
  "Appraised Value": "Fields.356",
  "Loan Number": "Fields.364",
  "Lien Position": "Fields.420",
  "Product Type": "Fields.608",
  CLTV: "Fields.976",
  "Loan Type": "Fields.1172",
  "Current Loan Status": "Fields.1393",
  "Loan Program": "Fields.1401",
  "Base Loan Amount": "Fields.1109",
  HCLTV: "Fields.1540",
  "Loan Purpose": "Fields.19",
  Channel: "Fields.2626",
  "Loan Source": "Fields.2024",
  GUID: "Fields.GUID",
  "Loan Folder": "Loan.LoanFolder",
  "Last Modified Date": "Loan.LoanLastModified",
  "Current Milestone": "Fields.Log.MS.CurrentMilestone",

  // ============================================================================
  // PROPERTY INFORMATION
  // ============================================================================
  "Property Street": "Fields.11",
  "Property City": "Fields.12",
  "Property County": "Fields.13",
  "Property State": "Fields.14",
  "Property Zip": "Fields.15",
  "Number of Units": "Fields.16",
  "County FIPS Code": "Fields.1396",
  "State FIPS Code": "Fields.1395",
  "Property Rights": "Fields.1066",
  "Property Type": "Fields.1553",
  "Occupancy Type": "Fields.1811",
  "Property Valuation Method Type": "Fields.ULDD.X29",
  "Property Valuation Effective Date": "Fields.ULDD.X30",
  "Total Mortgaged Properties Count":
    "Fields.ULDD.TotalMortgagedPropertiesCount",

  // ============================================================================
  // BORROWER INFORMATION
  // ============================================================================
  "FICO Score": "Fields.VASUMM.X23",
  "Income Total Mo Income": "Fields.736",
  "BE DTI Ratio": "Fields.742",
  "BORR EMPLOYER": "Fields.FE0102",
  "Borr Position": "Fields.FE0110",
  "Borr Position - 2nd": "Fields.FE0110#2",
  "Borr Yrs on Job": "Fields.FE0113",
  "Borr Yrs on Job - 2nd": "Fields.FE0113#2",
  "Borr Self Employed": "Fields.FE0115",
  "Borr Self Employed - 2nd": "Fields.FE0115#2",
  "Co-Borr Employer": "Fields.FE0202",
  "Co-Borr Position": "Fields.FE0210",
  "Co-Borr Yrs on Job": "Fields.FE0213",
  "Co-Borr Self Employed": "Fields.FE0215",
  "Borrower Type": "Fields.ULDD.X150",
  "CoBorrower Type": "Fields.ULDD.X151",
  "Borrower Mailing Address is same as the Property Address": "Fields.ULDD.X26",
  "CoBorrower Mailing Address is same as the Property Address":
    "Fields.ULDD.X154",
  "Combined Assets All Borrowers": "Fields.1547",
  "Assets Subtotal Liquid Assets": "Fields.915",

  // ============================================================================
  // PRICING & RATE LOCK
  // ============================================================================
  "Lock Days": "Fields.432",
  "Lock Date": "Fields.761",
  "Lock Expiration Date": "Fields.762",
  "Rate Lock Buy Side Net Buy Rate": "Fields.2160",
  "Rate Lock Buy Side Base Price Rate": "Fields.2161",
  "Net Buy": "Fields.2203",
  "Net Sell": "Fields.2274",
  "SRP from investor": "Fields.2276",
  "Discount / Yield Spread Premium": "Fields.2277",
  "Rate Lock Buy Side Adjusted Buy Price": "Fields.3420",
  "Corporate Price Concession": "Fields.3371",
  "Branch Price Concession": "Fields.3375",
  "Buy Side Lock Date": "Fields.2149",
  "Buy Side Lock # Days": "Fields.2150",
  "Buy Side Lock Expiration": "Fields.2151",
  "Sell Side Lock # Days": "Fields.2221",
  "Sell Side Lock Expiration": "Fields.2222",

  // Rate Lock Profit Margin Adjustments
  "Rate Lock Buy Side Profit Margin Adjustment 1 Desc": "Fields.3380",
  "Rate Lock Buy Side Profit Margin Adjustment 1 Rate": "Fields.3381",
  "Rate Lock Buy Side Profit Margin Adjustment 2 Desc": "Fields.3382",
  "Rate Lock Buy Side Profit Margin Adjustment 2 Rate": "Fields.3383",
  "Rate Lock Buy Side Profit Margin Adjustment 3 Desc": "Fields.3384",
  "Rate Lock Buy Side Profit Margin Adjustment 3 Rate": "Fields.3385",
  "Rate Lock Buy Side Profit Margin Adjustment 4 Desc": "Fields.3386",
  "Rate Lock Buy Side Profit Margin Adjustment 4 Rate": "Fields.3387",
  "Rate Lock Buy Side Profit Margin Adjustment 5 Desc": "Fields.3388",
  "Rate Lock Buy Side Profit Margin Adjustment 5 Rate": "Fields.3389",
  "Rate Lock Buy Side Profit Margin Adjustment 6 Desc": "Fields.3390",
  "Rate Lock Buy Side Profit Margin Adjustment 6 Rate": "Fields.3391",
  "Rate Lock Buy Side Profit Margin Adjustment 7 Desc": "Fields.3392",
  "Rate Lock Buy Side Profit Margin Adjustment 7 Rate": "Fields.3393",
  "Rate Lock Buy Side Profit Margin Adjustment 8 Desc": "Fields.3394",
  "Rate Lock Buy Side Profit Margin Adjustment 8 Rate": "Fields.3395",

  // ============================================================================
  // INVESTOR & SERVICING
  // ============================================================================
  Investor: "Fields.VEND.X263",
  "Investor Status": "Fields.2031",
  "Investor Lock Date": "Fields.2220",
  "Investor Purchase Date": "Fields.2370",
  "Service Fee": "Fields.3888",
  "Guaranty Fee": "Fields.3889",
  "MSR Value": "Fields.4118",
  "Hedged Loan": "Fields.2401",
  "Warehouse Co Name": "Fields.VEND.X200",

  // PA Payouts
  "PA Payout 1": "Fields.2373",
  "PA Payout 2": "Fields.2375",
  "PA Payout 3": "Fields.2377",
  "PA Payout 4": "Fields.2379",
  "PA Payout 5": "Fields.2381",
  "PA Payout 6": "Fields.2383",
  "PA Payout 7": "Fields.2385",
  "PA Payout 8": "Fields.2387",
  "PA Payout 9": "Fields.2389",
  "PA Payout 10": "Fields.2391",
  "PA Payout 11": "Fields.2393",
  "PA Payout 12": "Fields.2395",
  "PA Sell Amt": "Fields.3424",
  "PA SRP Amt": "Fields.3428",

  // ============================================================================
  // UNDERWRITING
  // ============================================================================
  "Underwriter Risk Assess Type": "Fields.1543",
  "Underwriter Risk Assess AUS Recomm": "Fields.1544",
  "Underwriting Description": "Fields.1556",
  "Underwriting AUS Source": "Fields.2312",
  "AU Decision Date": "Fields.2313",
  "Underwriting AUS Number": "Fields.2316",
  "DU/LP Case ID": "Fields.DU.LP.ID",
  "Fannie AU Decision": "Fields.ULDD.FNM.AutoUWDec",
  "Fannie Property Valuation Form Type": "Fields.ULDD.FNM.PropertyFormType",
  "Freddie AU Decision": "Fields.ULDD.FRE.AutoUWDec",
  "Freddie AVM Model Name Type Other Description":
    "Fields.ULDD.FRE.AVMModelNameExpl",
  "Freddie Property Valuation Form Type": "Fields.ULDD.FRE.PropertyFormType",
  "Freddie Loan Level Credit Score Value": "Fields.ULDD.X101",
  "Freddie Loan Level Credit Score Method": "Fields.ULDD.X102",
  "Freddie Underwriting Type Other": "Fields.ULDD.X149",
  "CU Risk Score": "Fields.MORNET.X92",
  "Number Of Conditions": "Fields.UWC.ALLCOUNT",
  "UW Touches": "Fields.CX.Count.UWSub",

  // ============================================================================
  // KEY DATES
  // ============================================================================
  "Application Date": "Fields.3142",
  "Current Status Date": "Fields.749",
  "Loan Estimate Sent Date": "Fields.3152",
  "Loan Estimate Received Date": "Fields.3153",
  "Revised LE Sent Date": "Fields.3154",
  "Revised LE Received Date": "Fields.3155",
  "Closing Disclosure Sent Date": "Fields.3977",
  "Closing Disclosure Received Date": "Fields.3978",
  "Revised CD Sent Date": "Fields.3979",
  "Revised CD Received Date": "Fields.3980",
  "Closing Date": "Fields.748",
  "Estimated Closing Date": "Fields.763",
  "Funds Sent Date": "Fields.1992",
  "Funding Date": "Fields.MS.FUN",
  "Shipped Date": "Fields.2014",
  "Appraisal Ordered Date": "Fields.2352",
  "Appraisal Completed Date": "Fields.2353",
  "Appraisal Received Date": "Fields.Document.DateReceived.Appraisal",
  "UW Suspended Date": "Fields.2303",
  "UW Denied Date": "Fields.2987",
  "Conditional Approval Date": "Fields.2300",
  "UW Final Approval Date": "Fields.2301",
  "CTC Date": "Fields.2305",
  "Credit Pull Date": "Fields.Document.DateReceived.CREDIT REPORT",
  "Loan First Payment Date": "Fields.682",
  "Flood Certification Date": "Fields.2365",
  "Note Date": "Fields.992",
  "Maturity Date": "Fields.78",
  "Submitted To Processing Date": "Fields.Log.MS.Date.Send To Processing",
  "Started Date": "Fields.Log.MS.Date.Started",
  "Submitted To Underwriting Date": "Fields.Log.MS.Date.Submittal",
  "PreApproval Req. Dt": "Fields.CX.PREAPP.REQ.DT",

  // ============================================================================
  // TEAM MEMBERS
  // ============================================================================
  "Loan Officer": "Fields.317",
  "Loan Officer ID": "Fields.LoanTeamMember.UserID.Loan Officer",
  "Legacy Loan Officer ID": "Fields.LOID",
  "Loan Interviewer": "Fields.1612",
  "Loan Processor ID": "Fields.LoanTeamMember.UserID.Loan Processor",
  "Underwriter ID": "Fields.LoanTeamMember.UserID.Underwriter",
  "Closer ID": "Fields.LoanTeamMember.UserID.Closer",
  "Account Executive": "Fields.LoanTeamMember.Name.Account Executive",
  Closer: "Fields.LoanTeamMember.Name.Closer",
  Processor: "Fields.LoanTeamMember.Name.Loan Processor",
  Underwriter: "Fields.LoanTeamMember.Name.Underwriter",
  "Broker Lender Name": "Fields.315",
  Branch: "Fields.ORGID",
  "Company NMLS ID": "Fields.3237",
  "NMLS ID": "Fields.3238",
  ORGID: "Fields.ORGID",
  "Mers Min": "Fields.1051",

  // ============================================================================
  // ARM FIELDS
  // ============================================================================
  "First Rate Adjustment Cap": "Fields.697",
  "First Rate Adjustment Date": "Fields.3054",
  "Floor Rate": "Fields.1699",
  "Life Cap": "Fields.247",
  Margin: "Fields.689",
  "ARM Program": "Fields.995",
  "Margin Index": "Fields.688",
  Rounding: "Fields.1700",
  Lookback: "Fields.ARM.IdxLkbckPrd",
  "1st Change Months": "Fields.696",
  "Maximum Rate Adjustment Cap": "Fields.695",
  "Adjustment Period Months": "Fields.694",
  "Description of the ARM index type": "Fields.1959",
  "Interest Only Payments": "Fields.CD4.X23",
  "Number of Months Interest Only Payments": "Fields.1177",
  "Balloon Payments": "Fields.1659",

  // ============================================================================
  // PAYMENT & MI
  // ============================================================================
  "P&I Payment": "Fields.5",
  "PITI Payment": "Fields.912",
  "PMI Flag": "Fields.8",
  "Mortgage Insurance Company Name": "Fields.L248",
  "Private Mortgage Insurance Indicator": "Fields.3336",
  "MI % Coverage 1": "Fields.1199",
  "MI Coverage 1 Months": "Fields.1198",
  "Mi % Coverage 2": "Fields.1201",
  "MI Coverage 2 Months": "Fields.1200",
  "MI Cancel %": "Fields.1205",
  "Number of Months Reserves": "Fields.1548",

  // ============================================================================
  // HELOC
  // ============================================================================
  "HELOC Intial Draw": "Fields.1888",
  "HELOC Draw Period": "Fields.1889",
  "HELOC Repayment Period": "Fields.1890",

  // ============================================================================
  // COMPLIANCE
  // ============================================================================
  "Interest Only Indicator": "Fields.HMDA.X109",
  "Business or Commercial Purpose": "Fields.HMDA.X58",
  "Document Type": "Fields.MORNET.X67",
  "Frefinance Cash Out Type": "Fields.ULDD.X18",
  "Exempt from Reg. Z": "Fields.QM.X103",
  "ATR Loan Type": "Fields.QM.X23",
  "QM Loan Type": "Fields.QM.X24",
  "Safe Harbor": "Fields.QM.X25",
  "Meets Agency/GSE QM": "Fields.QM.X62",
  "CD Applied Cure": "Fields.CD2.X2",
  "CD Lender Credits": "Fields.CD2.XSTLC",
  "Preapproval Flag": "Fields.HMDA.X12",

  // Mavent Compliance
  "Mavent - GSE Result": "Fields.COMPLIANCEREVIEW.X6",
  "Mavent - High-Cost result": "Fields.COMPLIANCEREVIEW.X7",
  "Mavent - Enterprise Result": "Fields.COMPLIANCEREVIEW.X5",
  "Mavent - ATR-QM Result": "Fields.COMPLIANCEREVIEW.X18",
  "Mavent - TILA Tolerance Result": "Fields.COMPLIANCEREVIEW.X14",
  "Mavent - NMLS Licensing Result": "Fields.COMPLIANCEREVIEW.X17",
  "Mavent - State Rules Result": "Fields.COMPLIANCEREVIEW.X12",
  "Mavent - HMDA Result": "Fields.COMPLIANCEREVIEW.X8",
  "Mavent - HPML Result": "Fields.COMPLIANCEREVIEW.X16",
  "Mavent - License Reviewer Result": "Fields.COMPLIANCEREVIEW.X9",
  "Mavent - Other Result": "Fields.COMPLIANCEREVIEW.X11",
  "Mavent - Overall Result": "Fields.COMPLIANCEREVIEW.X1",

  // ============================================================================
  // FEES
  // ============================================================================
  "Orig Fees Seller": "Fields.559",
  "Origination Points": "Fields.NEWHUD.X1151",
  "Orig Fee Borr Pd": "Fields.NEWHUD.X686",

  // Appraisal Fee Details
  "Fee Details - Line 804 - Borrower Amount - Appraisal Fee": "Fields.641",
  "Fee Details - Line 804 - Seller Amount - Appraisal Fee": "Fields.581",
  "Fee Details - Line 804 Appraisal Fee PAC": "Fields.NEWHUD2.X1100",
  "Fee Details - Line 804 - Borrower POC Amount - Appraisal":
    "Fields.NEWHUD2.X1101",
  "Fee Details - Line 804 - Seller POC Amount - Appraisal":
    "Fields.NEWHUD2.X1104",
  "Fee Details - Line 804 - Broker POC Amount - Appraisal":
    "Fields.NEWHUD2.X1107",
  "Fee Details - Line 804 - Lender POC Amount - Appraisal":
    "Fields.NEWHUD2.X1110",
  "Fee Details - Line 804 - Other POC Amount - Appraisal":
    "Fields.NEWHUD2.X1113",

  // Credit Report Fee Details
  "Fee Details - Line 805 - Borrower Amount - Credit Report": "Fields.640",
  "Fee Details - Line 805 - Seller Amount - Credit Report": "Fields.580",
  "Fee Details - Line 805 Credit Report Fee PAC": "Fields.NEWHUD2.X1133",
  "Fee Details - Line 805 - Borrower POC Amount - Cred Report":
    "Fields.NEWHUD2.X1134",
  "Fee Details - Line 805 - Seller POC Amount - Cred Report":
    "Fields.NEWHUD2.X1137",
  "Fee Details - Line 805 - Broker POC Amount - Cred Report":
    "Fields.NEWHUD2.X1140",
  "Fee Details - Line 805 - Lender POC Amount - Cred Report":
    "Fields.NEWHUD2.X1143",
  "Fee Details - Line 805 - Other POC Amount - Cred Report":
    "Fields.NEWHUD2.X1146",

  // Flood Cert Fee Details
  "Fee Details - Line 807 - Borrower Amount - Flood Cert": "Fields.NEWHUD.X400",
  "Fee Details - Line 807 - Seller Amount - Flood Cert": "Fields.NEWHUD.X781",
  "Fee Details - Line 807 Flood Certification Fee PAC": "Fields.NEWHUD2.X1199",
  "Fee Details - Line 807 - Borrower POC Amount - Flood Cert":
    "Fields.NEWHUD2.X1200",
  "Fee Details - Line 807 - Seller POC Amount - Flood Cert":
    "Fields.NEWHUD2.X1203",
  "Fee Details - Line 807 - Broker POC Amount - Flood Cert":
    "Fields.NEWHUD2.X1206",
  "Fee Details - Line 807 - Lender POC Amount - Flood Cert":
    "Fields.NEWHUD2.X1209",
  "Fee Details - Line 807 - Other POC Amount - Flood Cert":
    "Fields.NEWHUD2.X1212",
};

/**
 * Get all Coheus aliases
 */
export function getAllCoheusAliases(): string[] {
  return Object.keys(DEFAULT_ENCOMPASS_FIELD_MAPPINGS);
}

/**
 * Get the default Encompass field ID for a Coheus alias
 */
export function getDefaultEncompassFieldId(alias: string): string | null {
  return DEFAULT_ENCOMPASS_FIELD_MAPPINGS[alias] || null;
}

/**
 * Get mapping count for diagnostics
 */
export function getFieldMappingCount(): number {
  return Object.keys(DEFAULT_ENCOMPASS_FIELD_MAPPINGS).length;
}

/**
 * Validate that a field ID exists in the default mappings
 */
export function isValidCoheusAlias(alias: string): boolean {
  return alias in DEFAULT_ENCOMPASS_FIELD_MAPPINGS;
}

/**
 * Get all mappings as an array (useful for UI display)
 */
export function getAllMappingsAsArray(): Array<{
  alias: string;
  fieldId: string;
}> {
  return Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS).map(
    ([alias, fieldId]) => ({
      alias,
      fieldId,
    })
  );
}

// ============================================================================
// CATEGORY HELPER FUNCTIONS
// ============================================================================

/**
 * Get the category for a Coheus alias
 */
export function getFieldCategory(alias: string): FieldCategory {
  return FIELD_CATEGORY_MAP[alias] || "loan_info"; // Default to loan_info if not found
}

/**
 * Get the category metadata (label, description) for an alias
 */
export function getFieldCategoryInfo(alias: string): {
  category: FieldCategory;
  label: string;
  description: string;
  order: number;
} {
  const category = getFieldCategory(alias);
  const info = FIELD_CATEGORIES[category];
  return {
    category,
    label: info.label,
    description: info.description,
    order: info.order,
  };
}

/**
 * Get all categories sorted by order
 */
export function getAllCategories(): Array<{
  category: FieldCategory;
  label: string;
  description: string;
  order: number;
}> {
  return Object.entries(FIELD_CATEGORIES)
    .map(([category, info]) => ({
      category: category as FieldCategory,
      label: info.label,
      description: info.description,
      order: info.order,
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * Field data types for UI display
 */
export type FieldDataType =
  | "date"
  | "number"
  | "string"
  | "boolean"
  | "currency"
  | "percentage";

/**
 * Infer the data type from the alias name and field ID
 */
export function inferFieldDataType(
  alias: string,
  fieldId: string
): FieldDataType {
  const lowerAlias = alias.toLowerCase();
  const lowerFieldId = fieldId.toLowerCase();

  // Date fields
  if (
    lowerAlias.includes("date") ||
    lowerAlias.includes("maturity") ||
    lowerFieldId.includes(".date.") ||
    lowerFieldId.includes("lastmodified") ||
    FIELD_CATEGORY_MAP[alias] === "dates"
  ) {
    return "date";
  }

  // Currency/amount fields
  if (
    lowerAlias.includes("amount") ||
    lowerAlias.includes("payment") ||
    lowerAlias.includes("fee") ||
    lowerAlias.includes("price") ||
    lowerAlias.includes("value") ||
    lowerAlias.includes("payout") ||
    lowerAlias.includes("income") ||
    lowerAlias.includes("assets")
  ) {
    return "currency";
  }

  // Percentage fields
  if (
    lowerAlias.includes("rate") ||
    lowerAlias.includes("ratio") ||
    lowerAlias.includes("ltv") ||
    lowerAlias.includes("dti") ||
    lowerAlias.includes("%") ||
    lowerAlias.includes("coverage") ||
    lowerAlias.includes("margin")
  ) {
    return "percentage";
  }

  // Number fields
  if (
    lowerAlias.includes("number") ||
    lowerAlias.includes("count") ||
    lowerAlias.includes("score") ||
    lowerAlias.includes("months") ||
    lowerAlias.includes("days") ||
    lowerAlias.includes("term") ||
    lowerAlias.includes("units") ||
    lowerAlias.includes("cap") ||
    lowerAlias.includes("touches")
  ) {
    return "number";
  }

  // Boolean fields
  if (
    lowerAlias.includes("flag") ||
    lowerAlias.includes("indicator") ||
    lowerAlias.includes("self employed") ||
    lowerAlias.includes("hedged") ||
    lowerAlias.includes("same as")
  ) {
    return "boolean";
  }

  // Default to string
  return "string";
}

/**
 * Get field count per category
 */
export function getFieldCountsByCategory(): Record<FieldCategory, number> {
  const counts: Record<FieldCategory, number> = {
    loan_info: 0,
    property: 0,
    borrower: 0,
    pricing: 0,
    investor: 0,
    underwriting: 0,
    dates: 0,
    team: 0,
    arm: 0,
    payment_mi: 0,
    heloc: 0,
    compliance: 0,
    fees: 0,
  };

  for (const alias of Object.keys(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
    const category = getFieldCategory(alias);
    counts[category]++;
  }

  return counts;
}

// Log mapping count at import time
console.log(
  `[DefaultEncompassFieldMappings] Loaded ${getFieldMappingCount()} default field mappings across ${
    Object.keys(FIELD_CATEGORIES).length
  } categories`
);
