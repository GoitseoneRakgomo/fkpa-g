import json
import math
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Flask, jsonify, render_template

app = Flask(__name__)


def _fetch_json(url):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "FKPA-Global/1.0"})
    with urlopen(request, timeout=8) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError("Market data response was not a JSON object")
    return payload


def _positive_price(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Market data response did not include a numeric price")
    price = float(value)
    if not math.isfinite(price) or price <= 0:
        raise ValueError("Market data response included an invalid price")
    return price


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/api/market-prices')
def market_prices():
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            gold_future = executor.submit(_fetch_json, 'https://api.gold-api.com/price/XAU')
            silver_future = executor.submit(_fetch_json, 'https://api.gold-api.com/price/XAG')
            gold = gold_future.result()
            silver = silver_future.result()

        return jsonify({
            'gold': {
                'price': _positive_price(gold['price']),
                'updatedAt': gold['updatedAt'],
            },
            'silver': {
                'price': _positive_price(silver['price']),
                'updatedAt': silver['updatedAt'],
            },
        })
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, TypeError, ValueError) as error:
        app.logger.warning("Could not retrieve market prices: %s", error)
        return jsonify({'error': 'Market prices are temporarily unavailable.'}), 502


@app.route('/newsletter')
def newsletter():
    return render_template('newsletter.html')

# --- New Legal Pages ---

@app.route('/privacy')
def privacy():
    return render_template('privacy.html')

@app.route('/terms')
def terms():
    return render_template('terms.html')

@app.route('/website-terms')
def website_terms():
    return render_template('website_terms.html')

@app.route('/disclaimer')
def disclaimer():
    return render_template('disclaimer.html')

@app.route('/cookies')
def cookies():
    return render_template('cookies.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)