#!/usr/bin/env python3
"""
python/invoice_pdf.py
Generates an A4 Tax Invoice PDF using reportlab.
Reads JSON data on stdin and writes output PDF to sys.argv[1].
"""

import sys
import json
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.units import mm

def generate_invoice(data, output_path):
    shop = data.get("shop", {})
    bill = data.get("bill", {})
    items = data.get("items", [])

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm
    )

    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'ShopTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#1E293B'),
        spaceAfter=2
    )
    
    sub_style = ParagraphStyle(
        'ShopSub',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=colors.HexColor('#475569')
    )

    invoice_title_style = ParagraphStyle(
        'InvoiceTitle',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=colors.HexColor('#0F172A'),
        alignment=2 # Right align
    )

    info_label = ParagraphStyle(
        'InfoLabel',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=13,
        textColor=colors.HexColor('#334155')
    )

    info_value = ParagraphStyle(
        'InfoValue',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=colors.HexColor('#0F172A')
    )

    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=11,
        textColor=colors.HexColor('#FFFFFF'),
        alignment=0
    )

    table_header_right = ParagraphStyle(
        'TableHeaderRight',
        parent=table_header_style,
        alignment=2
    )

    cell_style = ParagraphStyle(
        'CellText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#1E293B')
    )

    cell_right = ParagraphStyle(
        'CellRight',
        parent=cell_style,
        alignment=2
    )

    thank_you_style = ParagraphStyle(
        'ThankYou',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=10,
        leading=14,
        alignment=1, # Center
        textColor=colors.HexColor('#475569')
    )

    story = []

    # 1. Header: Shop Info on Left, TAX INVOICE + Bill No on Right
    shop_info = [
        Paragraph(shop.get("name", "Pharmacy"), title_style),
        Paragraph(shop.get("address", ""), sub_style),
        Paragraph(f"Phone: {shop.get('phone', '')} | GSTIN: {shop.get('gstin', '')}", sub_style),
        Paragraph(f"Drug Licence No: {shop.get('drugLicence', '')}", sub_style)
    ]

    header_right = [
        Paragraph("TAX INVOICE", invoice_title_style),
        Spacer(1, 3 * mm),
        Paragraph(f"<b>Invoice No:</b> {bill.get('bill_no', '')}", ParagraphStyle('R1', parent=info_value, alignment=2)),
        Paragraph(f"<b>Date:</b> {bill.get('created_at', '')}", ParagraphStyle('R2', parent=info_value, alignment=2))
    ]

    header_table = Table([[shop_info, header_right]], colWidths=[110 * mm, 70 * mm])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0)
    ]))
    story.append(header_table)
    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#CBD5E1'), spaceAfter=8, spaceBefore=4))

    # 2. Billed To & Payment Meta
    cust_name = bill.get("customer_name") or "Walk-in Customer"
    cust_phone = bill.get("customer_phone") or "N/A"
    pay_mode = (bill.get("payment_mode") or "cash").upper()
    cashier = bill.get("cashier_name") or "Staff"

    meta_left = [
        Paragraph(f"<b>Customer Name:</b> {cust_name}", info_value),
        Paragraph(f"<b>Customer Phone:</b> {cust_phone}", info_value)
    ]
    meta_right = [
        Paragraph(f"<b>Billed By:</b> {cashier}", info_value),
        Paragraph(f"<b>Payment Mode:</b> {pay_mode}", info_value)
    ]

    meta_table = Table([[meta_left, meta_right]], colWidths=[90 * mm, 90 * mm])
    meta_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 2),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 5 * mm))

    # 3. Items Table
    # Columns: Medicine, Batch, Qty, MRP, Disc %, Price, Line Total
    headers = [
        Paragraph("Medicine", table_header_style),
        Paragraph("Batch", table_header_style),
        Paragraph("Qty", table_header_right),
        Paragraph("MRP", table_header_right),
        Paragraph("Disc %", table_header_right),
        Paragraph("Price", table_header_right),
        Paragraph("Total", table_header_right)
    ]

    table_data = [headers]

    for item in items:
        disc_str = f"{float(item.get('discount_pct', 0)):.1f}%" if float(item.get('discount_pct', 0)) > 0 else "-"
        mrp_str = f"{float(item.get('mrp', 0)):.2f}"
        price_str = f"{float(item.get('unit_price', 0)):.2f}"
        total_str = f"{float(item.get('line_total', 0)):.2f}"

        row = [
            Paragraph(str(item.get("medicine_name", "")), cell_style),
            Paragraph(str(item.get("batch_no", "")), cell_style),
            Paragraph(str(item.get("qty", 1)), cell_right),
            Paragraph(mrp_str, cell_right),
            Paragraph(disc_str, cell_right),
            Paragraph(price_str, cell_right),
            Paragraph(total_str, cell_right)
        ]
        table_data.append(row)

    col_widths = [62 * mm, 28 * mm, 14 * mm, 20 * mm, 16 * mm, 20 * mm, 20 * mm] # Total = 180mm
    items_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    
    t_style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1E293B')),
        ('ALIGN', (0, 0), (-1, 0), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0'))
    ]

    # Zebra striping for data rows
    for i in range(1, len(table_data)):
        if i % 2 == 0:
            t_style.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#F8FAFC')))

    items_table.setStyle(TableStyle(t_style))
    story.append(items_table)
    story.append(Spacer(1, 4 * mm))

    # 4. Summary Totals (Taxable Total, GST Total, Grand Total)
    taxable_val = f"Rs. {float(bill.get('taxable_total', 0)):.2f}"
    gst_val = f"Rs. {float(bill.get('gst_total', 0)):.2f}"
    grand_val = f"Rs. {float(bill.get('grand_total', 0)):.2f}"

    totals_data = [
        [Paragraph("Taxable Amount:", ParagraphStyle('TL', parent=info_value, alignment=2)),
         Paragraph(taxable_val, ParagraphStyle('TR', parent=info_value, alignment=2))],
        [Paragraph("GST Total:", ParagraphStyle('TL2', parent=info_value, alignment=2)),
         Paragraph(gst_val, ParagraphStyle('TR2', parent=info_value, alignment=2))],
        [Paragraph("<b>Grand Total:</b>", ParagraphStyle('TL3', parent=info_label, fontSize=11, alignment=2)),
         Paragraph(f"<b>{grand_val}</b>", ParagraphStyle('TR3', parent=info_label, fontSize=11, alignment=2))]
    ]

    totals_table = Table(totals_data, colWidths=[130 * mm, 50 * mm])
    totals_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LINEABOVE', (0, 2), (-1, 2), 1, colors.HexColor('#CBD5E1')),
        ('BACKGROUND', (0, 2), (-1, 2), colors.HexColor('#F1F5F9'))
    ]))
    story.append(totals_table)
    story.append(Spacer(1, 10 * mm))

    # 5. Thank you line
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#E2E8F0'), spaceAfter=8, spaceBefore=4))
    story.append(Paragraph("Thank you for your visit! Wishing you good health.", thank_you_style))

    doc.build(story)

def main():
    if len(sys.argv) < 2:
        print("Usage: invoice_pdf.py <output_pdf_path>", file=sys.stderr)
        sys.exit(1)

    output_path = sys.argv[1]

    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print("Error: Empty JSON input on stdin", file=sys.stderr)
            sys.exit(1)

        data = json.loads(raw_input)
        generate_invoice(data, output_path)
    except Exception as e:
        print(f"Error generating invoice PDF: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
