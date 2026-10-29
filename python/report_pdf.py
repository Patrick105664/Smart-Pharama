#!/usr/bin/env python3
"""
python/report_pdf.py
Generates clean report PDFs (finance, returns, marketing) using reportlab.
Reads JSON data on stdin and writes output PDF to sys.argv[1].
"""

import sys
import json
import os
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.units import mm

def format_currency(val):
    try:
        num = float(val or 0)
        return f"Rs. {num:,.2f}"
    except (ValueError, TypeError):
        return "Rs. 0.00"

def get_base_styles():
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'ShopTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=16,
        leading=20,
        textColor=colors.HexColor('#1E293B'),
        spaceAfter=2
    )

    sub_style = ParagraphStyle(
        'ShopSub',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor('#475569')
    )

    doc_title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=colors.HexColor('#0F172A'),
        alignment=2 # Right align
    )

    doc_meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor('#334155'),
        alignment=2
    )

    table_header = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#FFFFFF'),
        alignment=0
    )

    table_header_right = ParagraphStyle(
        'TableHeaderRight',
        parent=table_header,
        alignment=2
    )

    cell_style = ParagraphStyle(
        'CellText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor('#1E293B')
    )

    cell_right = ParagraphStyle(
        'CellRight',
        parent=cell_style,
        alignment=2
    )

    cell_bold = ParagraphStyle(
        'CellBold',
        parent=cell_style,
        fontName='Helvetica-Bold'
    )

    cell_bold_right = ParagraphStyle(
        'CellBoldRight',
        parent=cell_style,
        fontName='Helvetica-Bold',
        alignment=2
    )

    footer_style = ParagraphStyle(
        'FooterText',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=8,
        leading=11,
        alignment=1,
        textColor=colors.HexColor('#64748B')
    )

    return {
        'title': title_style,
        'sub': sub_style,
        'doc_title': doc_title_style,
        'doc_meta': doc_meta_style,
        'th': table_header,
        'th_r': table_header_right,
        'td': cell_style,
        'td_r': cell_right,
        'td_b': cell_bold,
        'td_br': cell_bold_right,
        'footer': footer_style
    }

def build_header(shop, report_title, meta_text, st):
    shop_info = [
        Paragraph(shop.get("name", "CityCare Pharmacy"), st['title']),
        Paragraph(shop.get("address", ""), st['sub']),
        Paragraph(f"Phone: {shop.get('phone', '')} | GSTIN: {shop.get('gstin', '')}", st['sub']),
        Paragraph(f"Drug Licence: {shop.get('drugLicence', '')}", st['sub'])
    ]

    right_info = [
        Paragraph(report_title.upper(), st['doc_title']),
        Spacer(1, 2 * mm)
    ]
    if meta_text:
        right_info.append(Paragraph(meta_text, st['doc_meta']))

    header_table = Table([[shop_info, right_info]], colWidths=[105 * mm, 75 * mm])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0)
    ]))
    return header_table

def generate_finance_pdf(data, output_path):
    shop = data.get("shop", {})
    fin = data.get("finance", {})
    gen_date = data.get("generated_at") or datetime.now().strftime("%Y-%m-%d %H:%M")
    range_lbl = fin.get("range", "month").capitalize()
    if range_lbl == "7d":
        range_lbl = "Last 7 Days"
    elif range_lbl == "Month":
        range_lbl = "This Month"
    elif range_lbl == "All":
        range_lbl = "All Time"

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm
    )
    st = get_base_styles()
    story = []

    # Header
    meta = f"<b>Date Range:</b> {range_lbl}<br/><b>Generated:</b> {gen_date}"
    story.append(build_header(shop, "Financial Report", meta, st))
    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#0284C7'), spaceAfter=8, spaceBefore=2))

    # Financial Performance Table
    tot_sales = format_currency(fin.get("total_sales") or fin.get("totalSales", 0))
    num_bills = str(fin.get("number_of_bills") or fin.get("numberOfBills", 0))
    gst_col = format_currency(fin.get("gst_collected") or fin.get("gstCollected", 0))
    saved_fs = format_currency(fin.get("money_saved") or fin.get("moneySaved", 0))
    lost_exp = format_currency(fin.get("money_lost") or fin.get("moneyLost", 0))
    exp_batch = format_currency(fin.get("expired_batch_loss", 0))
    ret_loss = format_currency(fin.get("returned_loss", 0))

    table_data = [
        [Paragraph("Metric", st['th']), Paragraph("Amount / Count", st['th_r'])],
        [Paragraph("<b>Total Sales Revenue</b>", st['td']), Paragraph(tot_sales, st['td_r'])],
        [Paragraph("Total Bills Generated", st['td']), Paragraph(f"{num_bills} bills", st['td_r'])],
        [Paragraph("GST Collected (Tax Component)", st['td']), Paragraph(gst_col, st['td_r'])],
        [Paragraph("<b>Money Saved by Flash Sales</b> (Discounts Recovered)", st['td']), Paragraph(saved_fs, st['td_r'])],
        [Paragraph("<b>Money Lost to Expiry</b> (Total Unrecovered)", st['td']), Paragraph(lost_exp, st['td_r'])],
        [Paragraph("&nbsp;&nbsp;&bull; Expired Active Stock Loss", st['td']), Paragraph(exp_batch, st['td_r'])],
        [Paragraph("&nbsp;&nbsp;&bull; Distributor Returns Unrecovered Loss", st['td']), Paragraph(ret_loss, st['td_r'])],
    ]

    t = Table(table_data, colWidths=[120 * mm, 60 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0F172A')),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#F8FAFC')),
        ('BACKGROUND', (0, 4), (-1, 4), colors.HexColor('#F0FDF4')), # Light green
        ('BACKGROUND', (0, 5), (-1, 5), colors.HexColor('#FEF2F2')), # Light red
    ]))
    story.append(t)
    story.append(Spacer(1, 12 * mm))

    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#E2E8F0'), spaceAfter=6, spaceBefore=4))
    story.append(Paragraph("Smart Pharma Management System &bull; Confidential Financial Report", st['footer']))

    doc.build(story)

def generate_returns_pdf(data, output_path):
    shop = data.get("shop", {})
    returns = data.get("returns", [])
    status_filter = data.get("status") or "all"
    gen_date = data.get("generated_at") or datetime.now().strftime("%Y-%m-%d %H:%M")

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm
    )
    st = get_base_styles()
    story = []

    status_lbl = status_filter.replace('_', ' ').capitalize()
    meta = f"<b>Status Filter:</b> {status_lbl}<br/><b>Generated:</b> {gen_date}"
    story.append(build_header(shop, "Distributor Returns Report", meta, st))
    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#0284C7'), spaceAfter=8, spaceBefore=2))

    # Flatten if returns are grouped
    flat_items = []
    if returns and isinstance(returns[0], dict) and "items" in returns[0]:
        for grp in returns:
            vendor_name = grp.get("vendor_name", "Unknown Vendor")
            for item in grp.get("items", []):
                item_copy = dict(item)
                item_copy["vendor_name"] = vendor_name
                flat_items.append(item_copy)
    else:
        flat_items = returns

    table_data = [
        [
            Paragraph("Vendor", st['th']),
            Paragraph("Medicine", st['th']),
            Paragraph("Batch", st['th']),
            Paragraph("Expiry", st['th']),
            Paragraph("Qty", st['th_r']),
            Paragraph("Cost", st['th_r']),
            Paragraph("Status", st['th']),
            Paragraph("Refund", st['th_r']),
        ]
    ]

    total_qty = 0
    total_cost = 0.0
    total_refund = 0.0

    if not flat_items:
        table_data.append([
            Paragraph("No return records found for this status.", st['td']),
            Paragraph("", st['td']), Paragraph("", st['td']), Paragraph("", st['td']),
            Paragraph("", st['td']), Paragraph("", st['td']), Paragraph("", st['td']),
            Paragraph("", st['td'])
        ])
    else:
        for r in flat_items:
            qty = int(r.get("qty", 0))
            cost = float(r.get("cost_value", 0))
            refund = float(r.get("refund_amount") or 0)
            total_qty += qty
            total_cost += cost
            total_refund += refund

            status_str = str(r.get("status", "")).replace('_', ' ').capitalize()
            table_data.append([
                Paragraph(str(r.get("vendor_name", "—")), st['td']),
                Paragraph(str(r.get("medicine_name", "—")), st['td']),
                Paragraph(str(r.get("batch_no", "—")), st['td']),
                Paragraph(str(r.get("expiry_date", "—")), st['td']),
                Paragraph(str(qty), st['td_r']),
                Paragraph(format_currency(cost), st['td_r']),
                Paragraph(status_str, st['td']),
                Paragraph(format_currency(refund) if refund > 0 else "—", st['td_r']),
            ])

        # Summary Row
        table_data.append([
            Paragraph("<b>Total</b>", st['td_b']),
            Paragraph("", st['td']), Paragraph("", st['td']), Paragraph("", st['td']),
            Paragraph(f"<b>{total_qty}</b>", st['td_br']),
            Paragraph(f"<b>{format_currency(total_cost)}</b>", st['td_br']),
            Paragraph("", st['td']),
            Paragraph(f"<b>{format_currency(total_refund)}</b>", st['td_br']),
        ])

    col_widths = [32 * mm, 34 * mm, 20 * mm, 20 * mm, 14 * mm, 22 * mm, 18 * mm, 20 * mm]
    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    t_style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0F172A')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
    ]
    if flat_items:
        t_style.append(('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#F1F5F9')))
        t_style.append(('LINEABOVE', (0, -1), (-1, -1), 1, colors.HexColor('#94A3B8')))
    t.setStyle(TableStyle(t_style))

    story.append(t)
    story.append(Spacer(1, 10 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#E2E8F0'), spaceAfter=6, spaceBefore=4))
    story.append(Paragraph("Smart Pharma Management System &bull; Distributor Returns Log", st['footer']))

    doc.build(story)

def generate_marketing_pdf(data, output_path):
    shop = data.get("shop", {})
    batches = data.get("batches", [])
    gen_date = data.get("generated_at") or datetime.now().strftime("%Y-%m-%d %H:%M")

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm
    )
    st = get_base_styles()
    story = []

    meta = f"<b>Total Batches:</b> {len(batches)}<br/><b>Generated:</b> {gen_date}"
    story.append(build_header(shop, "Marketing List - Flash Sales", meta, st))
    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#0284C7'), spaceAfter=8, spaceBefore=2))

    table_data = [
        [
            Paragraph("Medicine Name", st['th']),
            Paragraph("Batch No", st['th']),
            Paragraph("Expiry", st['th']),
            Paragraph("Days Left", st['th_r']),
            Paragraph("Rack", st['th']),
            Paragraph("Qty", st['th_r']),
            Paragraph("MRP", st['th_r']),
            Paragraph("Flash Price", st['th_r']),
            Paragraph("Discount", st['th_r'])
        ]
    ]

    if not batches:
        table_data.append([
            Paragraph("No yellow batches eligible for flash sales.", st['td']),
            Paragraph("", st['td']), Paragraph("", st['td']), Paragraph("", st['td']),
            Paragraph("", st['td']), Paragraph("", st['td']), Paragraph("", st['td']),
            Paragraph("", st['td']), Paragraph("", st['td'])
        ])
    else:
        for b in batches:
            mrp_val = float(b.get("mrp") or b.get("selling_price") or 0)
            flash_val = float(b.get("today_flash_price") or b.get("flash_price") or mrp_val)
            disc_pct = int(b.get("discount_pct") or 0)
            days = b.get("days_left", 0)

            table_data.append([
                Paragraph(str(b.get("name") or b.get("medicine_name") or "—"), st['td']),
                Paragraph(str(b.get("batch") or b.get("batch_no") or "—"), st['td']),
                Paragraph(str(b.get("expiry") or b.get("expiry_date") or "—"), st['td']),
                Paragraph(f"{days}d", st['td_r']),
                Paragraph(str(b.get("rack") or "—"), st['td']),
                Paragraph(str(b.get("qty", 0)), st['td_r']),
                Paragraph(format_currency(mrp_val), st['td_r']),
                Paragraph(format_currency(flash_val), st['td_r']),
                Paragraph(f"{disc_pct}%" if disc_pct > 0 else "0%", st['td_r'])
            ])

    col_widths = [42 * mm, 22 * mm, 18 * mm, 14 * mm, 12 * mm, 12 * mm, 20 * mm, 22 * mm, 18 * mm]
    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0F172A')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
    ]))

    story.append(t)
    story.append(Spacer(1, 10 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#E2E8F0'), spaceAfter=6, spaceBefore=4))
    story.append(Paragraph("Smart Pharma Management System &bull; Yellow Batches Marketing & Promotional List", st['footer']))

    doc.build(story)

def main():
    if len(sys.argv) < 2:
        print("Usage: report_pdf.py <output_pdf_path>", file=sys.stderr)
        sys.exit(1)

    output_path = sys.argv[1]

    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print("Error: Empty JSON input on stdin", file=sys.stderr)
            sys.exit(1)

        payload = json.loads(raw_input)
        report_type = payload.get("type", "").lower()

        if report_type == "finance":
            generate_finance_pdf(payload, output_path)
        elif report_type == "returns":
            generate_returns_pdf(payload, output_path)
        elif report_type == "marketing":
            generate_marketing_pdf(payload, output_path)
        else:
            print(f"Error: Unknown report type '{report_type}'", file=sys.stderr)
            sys.exit(1)

    except Exception as e:
        print(f"Error generating report PDF: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
