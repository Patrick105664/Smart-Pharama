import sys
import json
import csv
import io
import re
from datetime import datetime

REQUIRED_COLUMNS = [
    'barcode', 'name', 'category', 'manufacturer', 'gst_percent',
    'prescription_required', 'batch_no', 'expiry_date', 'qty',
    'purchase_price', 'selling_price', 'rack', 'vendor_name'
]

VALID_CATEGORIES = {
    'Tablets', 'Capsules', 'Syrups', 'Injections', 'Ointments & Creams',
    'Drops', 'Inhalers', 'Supplements & Vitamins', 'Baby Care', 'Surgical & First Aid'
}

VALID_GST = {0, 5, 12, 18}
RACK_PATTERN = re.compile(r'^[A-E][1-5]$')
DATE_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}$')

def validate_csv(csv_text):
    valid_rows = []
    errors = []

    if not csv_text or not csv_text.strip():
        return {
            'valid_rows': [],
            'errors': [{'row': 1, 'message': 'CSV content is empty'}]
        }

    try:
        reader = csv.reader(io.StringIO(csv_text.strip()))
    except Exception as e:
        return {
            'valid_rows': [],
            'errors': [{'row': 1, 'message': f'Failed to parse CSV: {str(e)}'}]
        }

    try:
        header = next(reader)
    except StopIteration:
        return {
            'valid_rows': [],
            'errors': [{'row': 1, 'message': 'CSV has no header row'}]
        }

    # Normalize header column names
    header_clean = [col.strip().lower() for col in header]
    col_map = {col: idx for idx, col in enumerate(header_clean)}

    missing_cols = [c for c in REQUIRED_COLUMNS if c not in col_map]
    if missing_cols:
        return {
            'valid_rows': [],
            'errors': [{'row': 1, 'message': f"Missing required columns in header: {', '.join(missing_cols)}"}]
        }

    row_num = 1
    for raw_row in reader:
        row_num += 1
        if not raw_row or not any(cell.strip() for cell in raw_row):
            continue  # skip completely blank rows

        if len(raw_row) < len(header_clean):
            errors.append({'row': row_num, 'message': f'Row has fewer columns than header ({len(raw_row)} vs {len(header_clean)})'})
            continue

        row_data = {col: raw_row[col_map[col]].strip() for col in REQUIRED_COLUMNS}

        # Check required non-empty string fields
        if not row_data['barcode']:
            errors.append({'row': row_num, 'message': 'Missing barcode'})
            continue

        if not row_data['name']:
            errors.append({'row': row_num, 'message': 'Missing medicine name'})
            continue

        if not row_data['batch_no']:
            errors.append({'row': row_num, 'message': 'Missing batch number'})
            continue

        if not row_data['vendor_name']:
            errors.append({'row': row_num, 'message': 'Missing vendor name'})
            continue

        # Category validation
        cat = row_data['category']
        matched_cat = next((vc for vc in VALID_CATEGORIES if vc.lower() == cat.lower()), None)
        if not matched_cat:
            errors.append({'row': row_num, 'message': f"Invalid category '{cat}'. Must be one of: {', '.join(sorted(VALID_CATEGORIES))}"})
            continue
        row_data['category'] = matched_cat

        # GST percent validation
        try:
            gst_val = int(float(row_data['gst_percent']))
            if gst_val not in VALID_GST:
                errors.append({'row': row_num, 'message': f"Invalid GST percent '{row_data['gst_percent']}'. Allowed: 0, 5, 12, 18"})
                continue
            row_data['gst_percent'] = gst_val
        except (ValueError, TypeError):
            errors.append({'row': row_num, 'message': 'GST percent must be a number (0, 5, 12, 18)'})
            continue

        # Prescription required validation (yes/no)
        rx_val = row_data['prescription_required'].lower()
        if rx_val in ('yes', 'y', 'true', '1'):
            row_data['prescription_required'] = 1
        elif rx_val in ('no', 'n', 'false', '0'):
            row_data['prescription_required'] = 0
        else:
            errors.append({'row': row_num, 'message': "prescription_required must be 'yes' or 'no'"})
            continue

        # Rack validation
        rack = row_data['rack'].upper()
        if not RACK_PATTERN.match(rack):
            errors.append({'row': row_num, 'message': f"Invalid rack '{row_data['rack']}'. Must match pattern like A1..E5"})
            continue
        row_data['rack'] = rack

        # Expiry date validation (YYYY-MM-DD)
        exp_date_str = row_data['expiry_date']
        if not DATE_PATTERN.match(exp_date_str):
            errors.append({'row': row_num, 'message': f"Expiry date must be in YYYY-MM-DD format, got '{exp_date_str}'"})
            continue
        try:
            datetime.strptime(exp_date_str, '%Y-%m-%d')
        except ValueError:
            errors.append({'row': row_num, 'message': f"Invalid date value '{exp_date_str}'"})
            continue

        # Quantity validation
        try:
            qty_val = int(row_data['qty'])
            if qty_val < 0:
                errors.append({'row': row_num, 'message': 'Quantity must be >= 0'})
                continue
            row_data['qty'] = qty_val
        except (ValueError, TypeError):
            errors.append({'row': row_num, 'message': 'Quantity must be an integer'})
            continue

        # Purchase price and Selling price
        try:
            purchase_price = float(row_data['purchase_price'])
            if purchase_price <= 0:
                errors.append({'row': row_num, 'message': 'Purchase price must be > 0'})
                continue
            row_data['purchase_price'] = round(purchase_price, 2)
        except (ValueError, TypeError):
            errors.append({'row': row_num, 'message': 'Purchase price must be a valid number'})
            continue

        try:
            selling_price = float(row_data['selling_price'])
            if selling_price <= 0:
                errors.append({'row': row_num, 'message': 'Selling price must be > 0'})
                continue
            row_data['selling_price'] = round(selling_price, 2)
        except (ValueError, TypeError):
            errors.append({'row': row_num, 'message': 'Selling price must be a valid number'})
            continue

        if row_data['selling_price'] < row_data['purchase_price']:
            errors.append({'row': row_num, 'message': f"Selling price ({row_data['selling_price']}) cannot be less than purchase price ({row_data['purchase_price']})"})
            continue

        row_data['row_num'] = row_num
        valid_rows.append(row_data)

    return {
        'valid_rows': valid_rows,
        'errors': errors
    }

def main():
    input_text = sys.stdin.read()
    csv_content = input_text
    trimmed = input_text.strip()
    if trimmed.startswith('{') and trimmed.endswith('}'):
        try:
            data = json.loads(trimmed)
            if 'csv' in data:
                csv_content = data['csv']
        except Exception:
            pass

    result = validate_csv(csv_content)
    print(json.dumps(result))

if __name__ == '__main__':
    main()
