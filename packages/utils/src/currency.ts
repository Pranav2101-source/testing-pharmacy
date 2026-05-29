export function formatCurrency(
  amount: number,
  symbol = "₹",
  locale = "en-IN"
): string {
  return `${symbol}${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

export function formatAmountInWords(amount: number): string {
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty",
    "Sixty", "Seventy", "Eighty", "Ninety",
  ];

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  function convert(n: number): string {
    if (n === 0) return "";
    if (n < 20) return (ones[n] ?? "") + " ";
    if (n < 100) return (tens[Math.floor(n / 10)] ?? "") + " " + convert(n % 10);
    if (n < 1000) return (ones[Math.floor(n / 100)] ?? "") + " Hundred " + convert(n % 100);
    if (n < 100000) return convert(Math.floor(n / 1000)) + "Thousand " + convert(n % 1000);
    if (n < 10000000) return convert(Math.floor(n / 100000)) + "Lakh " + convert(n % 100000);
    return convert(Math.floor(n / 10000000)) + "Crore " + convert(n % 10000000);
  }

  const rupeesWords = convert(rupees).trim() || "Zero";
  const result = `${rupeesWords} Rupees`;
  if (paise > 0) {
    return `${result} and ${convert(paise).trim()} Paise Only`;
  }
  return `${result} Only`;
}
