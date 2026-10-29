// config/rules.js – All business rules in one place for easy tuning

module.exports = {
  // Expiry status thresholds (days_left = DATEDIFF(expiry_date, CURDATE()))
  expiryRedMax: -1,       // days_left < 0  → RED (expired)
  expiryYellowMin: 0,     // days_left >= 0 → YELLOW (expiring soon)
  expiryYellowMax: 30,    // days_left <= 30
  // days_left > 30 → GREEN (safe)

  // Flash sale discount tiers (only for is_flash_sale = 1 batches)
  flashSaleTiers: [
    { minDays: 15, maxDays: 30, discountPct: 10 },
    { minDays: 8,  maxDays: 14, discountPct: 20 },
    { minDays: 0,  maxDays: 7,  discountPct: 30 }
  ],

  // Low stock threshold (default, also stored in settings table)
  lowStockMin: 10,

  // Alert: "entered warning period in last N days"
  warningEntryDays: 3,    // days_left between 28 and 30

  // Calendar warning day offset
  warningDaysOffset: 30,  // expiry_date - 30 = day warning starts

  // Categories (fixed list, seeded)
  categories: [
    'Tablets', 'Capsules', 'Syrups', 'Injections',
    'Ointments & Creams', 'Drops', 'Inhalers',
    'Supplements & Vitamins', 'Baby Care', 'Surgical & First Aid'
  ],

  // Racks – A1..E5
  rackLetters: ['A', 'B', 'C', 'D', 'E'],
  rackNumbers: [1, 2, 3, 4, 5],

  // Valid GST percentages
  validGst: [0, 5, 12, 18],

  // Rack regex for CSV validation
  rackRegex: /^[A-E][1-5]$/,

  // Bill number prefix
  billPrefix: 'INV-',

  // Flash sale discount lookup (percentage only)
  getFlashSaleDiscountPct(daysLeft, isFlashSale) {
    if (!isFlashSale) return 0;
    const days = Number(daysLeft);
    for (const tier of this.flashSaleTiers) {
      if (days >= tier.minDays && days <= tier.maxDays) {
        return tier.discountPct;
      }
    }
    return 0;
  },

  // Flash sale calculation with purchase price floor
  calculateFlashDiscount(daysLeft, mrp, purchasePrice, isFlashSale) {
    const sellingPrice = Number(mrp);
    const costPrice = Number(purchasePrice);
    const nominalPct = this.getFlashSaleDiscountPct(daysLeft, isFlashSale);

    if (nominalPct === 0) {
      return {
        discountPct: 0,
        unitPrice: sellingPrice,
        isFloorApplied: false,
        flashSaleApplied: false
      };
    }

    // discounted_price = ROUND(selling_price * (1 - pct/100), 2)
    const discountedPrice = Math.round(sellingPrice * (1 - nominalPct / 100) * 100) / 100;

    // Floor check: NEVER below purchase_price
    if (discountedPrice < costPrice) {
      const effectivePct = sellingPrice > 0
        ? Math.round(((sellingPrice - costPrice) / sellingPrice) * 100 * 100) / 100
        : 0;
      return {
        discountPct: Math.max(0, effectivePct),
        unitPrice: costPrice,
        isFloorApplied: true,
        flashSaleApplied: effectivePct > 0
      };
    }

    return {
      discountPct: nominalPct,
      unitPrice: discountedPrice,
      isFloorApplied: false,
      flashSaleApplied: true
    };
  },

  // GST math (MRP includes GST)
  calculateGst(lineTotal, gstPercent) {
    const total = Number(lineTotal);
    const gstPct = Number(gstPercent);
    // taxable_value = ROUND(line_total * 100 / (100 + gst_percent), 2)
    const taxableValue = Math.round((total * 100 / (100 + gstPct)) * 100) / 100;
    // gst_amount = line_total - taxable_value
    const gstAmount = Math.round((total - taxableValue) * 100) / 100;
    return {
      taxableValue,
      gstAmount
    };
  }
};
