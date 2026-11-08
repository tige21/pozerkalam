#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

FIRST_PAID_INDEX = 10
BLOCK_COMMENT = r'/\*[\s\S]*?\*/'
LINE_COMMENT = r'//[^\n]*'
TRIVIA = re.compile(rf'(?:\s+|{BLOCK_COMMENT}|{LINE_COMMENT})*')
TOKEN = re.compile(
    rf'''{BLOCK_COMMENT}|{LINE_COMMENT}|'(?:[^'\\\r\n]|\\[\s\S])*'|"(?:[^"\\\r\n]|\\[\s\S])*"|[{{}}\[\]()'"/`]'''
)
DELIMITERS = {'{': '}', '[': ']', '(': ')'}
DIVIDEND = re.compile(r'[\w)\]]\s*$')
LEVEL_ENTRY = re.compile(r"(?P<object>\{)\s*name\s*:\s*'(?P<name>(?P<number>[1-9][0-9]*) · [^'\\\r\n]+)'")
DEMO_ENTRY = re.compile(r'(?P<number>0|[1-9][0-9]*)\s*:\s*(?P<object>\{)\s*segs\s*:\s*\[')
PRACTICE_TITLE = re.compile(r"(?m)^  practice:\s*\{\s*title:\s*'([^'\\\r\n]+)'")


def object_end(source, start):
    closers = []
    for match in TOKEN.finditer(source, start):
        token = match.group()
        if token in DELIMITERS:
            closers.append(DELIMITERS[token])
        elif token in DELIMITERS.values():
            if not closers or closers.pop() != token:
                break
            if not closers:
                return match.end()
        elif token in ("'", '"', '`') or (
            token == '/' and (
                source.startswith('/*', match.start()) or not DIVIDEND.search(source[max(start, match.start() - 32):match.start()])
            )
        ):
            break
    line = source.count('\n', 0, start) + 1
    raise ValueError(f'не удалось выделить объект на строке {line}')


def read_entries(source, name, opening, pattern):
    anchors = list(re.finditer(rf'(?m)^const {name}\s*=\s*{re.escape(opening)}', source))
    if len(anchors) != 1:
        raise ValueError(f'ожидалось одно объявление {name}')
    begin = anchors[0].end()
    cursor = TRIVIA.match(source, begin).end()
    entries = []
    ending = DELIMITERS[opening]
    while not source.startswith(ending, cursor):
        match = pattern.match(source, cursor)
        if match is None:
            line = source.count('\n', 0, cursor) + 1
            raise ValueError(f'неожиданная запись {name} на строке {line}')
        end = object_end(source, match.start('object'))
        entries.append((match, source[cursor:end]))
        cursor = TRIVIA.match(source, end).end()
        if source.startswith(',', cursor):
            cursor = TRIVIA.match(source, cursor + 1).end()
        elif not source.startswith(ending, cursor):
            raise ValueError(f'нет разделителя между записями {name}')
    if not source.startswith(ending + ';', cursor):
        raise ValueError(f'неожиданное завершение {name}')
    return begin, cursor, entries


def menu_stub(name, value):
    stub = {'name': name, 'premiumStub': True}
    header = value.split('\n', 1)[0]
    for flag in ('drill', 'pad', 'strict'):
        if f', {flag}:true,' in header or re.search(rf'(?m)^  {flag}:true,', value):
            stub[flag] = True
    if re.search(r'(?m)^  examRoute\(', value):
        stub['examRoute'] = True
    practice = PRACTICE_TITLE.search(value)
    if practice:
        stub['practice'] = {'title': practice[1]}
    elif re.search(r'(?m)^  practice:', value):
        raise ValueError(f'не удалось выделить название практики {name}')
    return json.dumps(stub, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')


def split_premium(source):
    if not re.search(rf'(?m)^const PAYWALL\s*=\s*\{{[^\n]*\bfrom:\s*{FIRST_PAID_INDEX}\s*\}};', source):
        raise ValueError('граница платных уровней должна совпадать с PAYWALL.from')
    level_begin, level_end, levels = read_entries(source, 'LEVELS', '[', LEVEL_ENTRY)
    demo_begin, demo_end, demos = read_entries(source, 'DEMOS', '{', DEMO_ENTRY)
    numbers = [int(match['number']) for match, _ in levels]
    if len(numbers) <= FIRST_PAID_INDEX or numbers != list(range(1, len(levels) + 1)):
        raise ValueError('ожидался полный список уровней в порядке номеров')
    demo_numbers = [int(match['number']) for match, _ in demos]
    if (
        demo_numbers != sorted(set(demo_numbers)) or not demo_numbers
        or demo_numbers[0] >= FIRST_PAID_INDEX or demo_numbers[-1] < FIRST_PAID_INDEX
        or demo_numbers[-1] >= len(levels)
    ):
        raise ValueError('ожидались демонстрации бесплатных и платных уровней в порядке номеров')
    if level_end >= demo_begin:
        raise ValueError('неожиданный порядок LEVELS и DEMOS')

    paid_levels = levels[FIRST_PAID_INDEX:]
    names = [match['name'] for match, _ in paid_levels]
    stubs = [menu_stub(match['name'], value) for match, value in paid_levels]
    public_levels = ',\n'.join([value for _, value in levels[:FIRST_PAID_INDEX]] + stubs)
    public_demos = ',\n'.join(value for match, value in demos if int(match['number']) < FIRST_PAID_INDEX)
    public_html = (
        source[:level_begin] + '\n' + public_levels + '\n' + source[level_end:demo_begin]
        + '\n' + public_demos + '\n' + source[demo_end:]
    )
    private_levels = ',\n'.join(value for _, value in paid_levels)
    private_demos = ',\n'.join(value for match, value in demos if int(match['number']) >= FIRST_PAID_INDEX)
    private_js = f'installPremiumLevels([\n{private_levels}\n], {{\n{private_demos}\n}});\n'
    return public_html, private_js, json.dumps(names, ensure_ascii=False) + '\n'


def main():
    parser = argparse.ArgumentParser()
    for argument in ('source', 'public_html', 'private_js', 'names_json'):
        parser.add_argument(argument, type=Path)
    args = parser.parse_args()
    paths = (args.source, args.public_html, args.private_js, args.names_json)
    if len(set(path.resolve() for path in paths)) != len(paths):
        parser.error('входной и выходные файлы должны различаться')
    try:
        public_html, private_js, names_json = split_premium(args.source.read_text(encoding='utf-8'))
        args.private_js.write_bytes(private_js.encode('utf-8'))
        args.names_json.write_bytes(names_json.encode('utf-8'))
        args.public_html.write_bytes(public_html.encode('utf-8'))
    except (OSError, ValueError) as error:
        parser.exit(1, f'веб-сборка Премиума: {error}\n')


if __name__ == '__main__':
    main()
