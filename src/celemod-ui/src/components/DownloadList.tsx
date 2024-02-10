import { h } from "preact";
import "./DownloadList.scss"
import { useGlobalContext } from "../App";
import { useEffect } from "react";
import { useRef, useState } from "preact/hooks";
import { Icon } from "./Icon";
import { Download } from "../context/download";

const Task = ({ task, width }: {
    task: Download.TaskInfo, width: number
}) => {
    const all = task.subtasks.length;
    const finished = task.subtasks.filter(v => v.state === 'Finished').length;

    const [expanded, setExpanded] = useState(false)

    return <div class="task">
        <label>
            <div className="infoLine">
                <button class="b1" onClick={() => {
                    setExpanded(v => !v)
                }}>{
                        <Icon name={expanded ? "i-down" : "i-right"} />
                    }</button>
                <span className="name">
                    {task.name}
                </span>
            </div>

            <div className="progressLine">
                <div class="progress">
                    <div class="bar" style={{
                        width: `${finished / all * width}px`
                    }}></div>
                </div>
                <div class="text">{finished} / {all}</div>
            </div>
        </label>
        {
            expanded && <div className="subTasks">
                {task.subtasks.filter(v => v.state !== 'Finished').map(subtask => <div class="subTask">
                    <div class="name">{subtask.name}</div>
                    <div className="progressLine">
                        <div class="progress">
                            <div class="bar" style={{
                                width: `${subtask.progress * width / 100}px`
                            }}></div>
                        </div>
                        <div class="text">{subtask.progress}%</div>
                    </div>
                    {
                        subtask.state === 'Failed' && <div class="error">
                            <Icon name="fail" />
                            {subtask.error}
                        </div>
                    }
                </div>)}
            </div>
        }



    </div>
}

export const DownloadListMenu = () => {
    const { download } = useGlobalContext()
    const [downloadTasks, setDownloadTasks] = useState(download.downloadTasks.current)

    useEffect(() => {
        download.eventBus.on('taskListChanged', () => {
            setDownloadTasks({ ...download.downloadTasks.current })
        })
    }, [])

    const width = 180

    return <menu className="popup downloadList">
        <h2>下载任务</h2>
        <div className="taskList">
            {Object.values(downloadTasks)
                .filter(v => v.state !== 'finished')
                .map(task => <Task task={task} width={width} />)}
        </div>
    </menu>
}