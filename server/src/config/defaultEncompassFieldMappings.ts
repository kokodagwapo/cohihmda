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
  category?:
    | "loan"
    | "borrower"
    | "property"
    | "pricing"
    | "dates"
    | "compliance"
    | "fees"
    | "team"
    | "other";
}

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
  "Last Rate Set Date": "Fields.3253",
  "Rate Lock Sell Side Last Rate Set Date": "Fields.3257",

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
  "Date Warehoused": "Fields.3341",
  "Repurchase Date": "Fields.3312",
  "Date Sold to Third Party": "Fields.3337",

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
  "Disbursement Date": "Fields.1997",
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
  "Closing Docs 1003 Signature Date": "Fields.3261",
  "GFE Application Date": "Fields.3142",
  "Initial Disclosure Due Date": "Fields.3143",
  "GFE Initial GFE Disclosure Provided Date": "Fields.3148",
  "TIL Intl Disclosure Provided Date": "Fields.3152",
  "Submitted To Processing Date": "Fields.Log.MS.Date.Send To Processing",
  "Started Date": "Fields.Log.MS.Date.Started",
  "Submitted To Underwriting Date": "Fields.Log.MS.Date.Submittal",
  "GFE Initial GFE Disclosure Affiliated Business Disclosure Provided Date":
    "Fields.3544",
  "GFE Initial GFE Disclosure CHARM Booklet Provided Date": "Fields.3545",
  "GFE Initial GFE Disclosure HUD Special Booklet Provided Date": "Fields.3546",
  "GFE Initial GFE Disclosure HELOC Brochure Provided Date": "Fields.3547",

  // Milestone Dates (short aliases - kept for backward compatibility where they map to unique fields)
  // NOTE: 'Started' removed - use 'Started Date' instead (both map to Fields.Log.MS.Date.Started)
  // NOTE: 'Funding' removed - use 'Funding Date' instead (Fields.MS.FUN, different from Fields.Log.MS.Date.Funding)
  PreApproval: "Fields.Log.MS.Date.PreApproval",
  "Disclosure Prep": "Fields.Log.MS.Date.Disclosure Prep",
  Signed: "Fields.Log.MS.Date.Signed",
  Scrubbed: "Fields.Log.MS.Date.Scrubbed",
  Processing: "Fields.Log.MS.Date.Processing", // Kept: different field than 'Submitted To Processing Date'
  Submittal: "Fields.Log.MS.Date.Submittal",
  "Cond. Approval": "Fields.Log.MS.Date.Cond. Approval",
  Resubmittal: "Fields.Log.MS.Date.Resubmittal",
  Approval: "Fields.Log.MS.Date.Approval",
  "Ready for Docs": "Fields.Log.MS.Date.Ready for Docs",
  "Closer Assignment": "Fields.Log.MS.Date.Closer Assignment",
  "Docs Out": "Fields.Log.MS.Date.Docs Out",
  "Docs Signing": "Fields.Log.MS.Date.Docs Signing",
  // 'Funding' removed - conflicts with 'Funding Date' (Fields.MS.FUN)
  Shipping: "Fields.Log.MS.Date.Shipping",
  Purchased: "Fields.Log.MS.Date.Purchased",
  Reconciled: "Fields.Log.MS.Date.Reconciled",
  Completion: "Fields.Log.MS.Date.Completion",
  "Appt Reset": "Fields.Log.MS.Date.Appt Reset",
  "Appt Set": "Fields.Log.MS.Date.Appt Set",
  "Doc Preparation": "Fields.Log.MS.Date.Doc Preparation",
  "Post Closing": "Fields.Log.MS.Date.Post Closing",

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
  "Referral Name": "Fields.1822",
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

// Log mapping count at import time
console.log(
  `[DefaultEncompassFieldMappings] Loaded ${getFieldMappingCount()} default field mappings`
);
