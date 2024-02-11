import { h } from "preact";
import { Icon } from "./Icon";
import "./GameSelector.scss"
import { callRemote, useBlockingMask } from "../utils";

export const GameSelector = (props: { paths: string[], onSelect: any, selectedPath?: string, launchGame: (v: string) => void }) => {
    if (!props.paths.length) return <div>No games found</div>;
    const mask = useBlockingMask();

    return (
        <div class="gameSelector">
            <div className="title">
                <Icon name="save" />
                <span>选择游戏路径</span>
            </div>
            <select onChange={props.onSelect} value={props.selectedPath || props.paths[0]}>
                {props.paths.map(p => <option value={p}>{p}</option>)}
            </select>

            <button style={{ marginLeft: 5, borderRadius: 4 }} onClick={() => {
                props.launchGame('everest')
            }}>启动 Everest</button>

            <button style={{ marginLeft: 5, borderRadius: 4 }} onClick={() => {
                props.launchGame('origin')
            }}>启动 原版</button>

            <button style={{ marginLeft: 5, borderRadius: 4 }} onClick={() => {
                callRemote("open_url", (props.selectedPath || props.paths[0]) + '/Mods');
            }}>Mods 文件夹</button>
        </div>
    );
}